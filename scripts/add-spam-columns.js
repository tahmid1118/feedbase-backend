/**
 * Spam protection for the PUBLIC board. Idempotent. Mirrored in feedboard_db.sql.
 *
 *   node scripts/add-spam-columns.js
 *
 * Adds three things:
 *
 * 1. `voter_hash` on votes/posts/comments — an HMAC of the client IP (see
 *    src/common/guestIdentity.js). This is the TRUSTED dedup key. `guest_id` is
 *    supplied by the client and is display-identity only: a bot rotating it
 *    defeated the old UNIQUE(tenant_id, post_id, guest_id) entirely, so votes
 *    now carry a second uniqueness constraint the client cannot forge.
 *
 *    NOTE the raw IP is never stored — only the salted hash.
 *
 * 2. Moderation columns on posts/comments. `moderation_state` is deliberately
 *    SEPARATE from `status`: status is the pipeline (open → planned → completed)
 *    and drives roadmap sync + the board tabs; spam is an orthogonal axis and
 *    overloading status would break both.
 *
 * 3. `public_write_counters` — burst caps that are accurate across PM2 workers,
 *    which the in-memory express-rate-limit counters are not.
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

const hasColumn = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
};

const hasIndex = async (table, index) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
};

const addColumns = async (table, adds) => {
  for (const [col, clause] of adds) {
    if (await hasColumn(table, col)) {
      console.log(`${table}.${col} already exists — skipping`);
    } else {
      await pool.query(`ALTER TABLE ${table} ${clause}`);
      console.log(`added ${table}.${col}`);
    }
  }
};

const addIndexes = async (table, indexes) => {
  for (const [idx, clause] of indexes) {
    if (await hasIndex(table, idx)) {
      console.log(`index ${table}.${idx} already exists — skipping`);
    } else {
      await pool.query(`ALTER TABLE ${table} ${clause}`);
      console.log(`added index ${table}.${idx}`);
    }
  }
};

// Shared moderation columns. `published` is the default so every existing row
// stays visible — this migration must never retroactively hide real feedback.
const MODERATION_COLUMNS = [
  [
    "moderation_state",
    "ADD COLUMN moderation_state ENUM('published','pending','spam') NOT NULL DEFAULT 'published'",
  ],
  ["spam_score", "ADD COLUMN spam_score TINYINT UNSIGNED NOT NULL DEFAULT 0"],
  ["spam_reasons", "ADD COLUMN spam_reasons TEXT NULL"],
  ["voter_hash", "ADD COLUMN voter_hash VARCHAR(64) NULL"],
];

(async () => {
  await addColumns("posts", MODERATION_COLUMNS);
  await addColumns("comments", MODERATION_COLUMNS);
  await addColumns("votes", [
    ["voter_hash", "ADD COLUMN voter_hash VARCHAR(64) NULL AFTER guest_id"],
  ]);

  // The constraint that actually closes the vote-stuffing hole. Existing rows
  // have voter_hash NULL, and MySQL permits many NULLs in a UNIQUE index, so
  // this is safe to add to a populated table.
  await addIndexes("votes", [
    [
      "uq_votes_voter_hash",
      "ADD UNIQUE KEY uq_votes_voter_hash (tenant_id, post_id, voter_hash)",
    ],
  ]);

  // Moderation queue reads filter on (tenant, state); public reads filter on
  // state alongside the existing tenant/status keys.
  await addIndexes("posts", [
    [
      "idx_posts_tenant_moderation",
      "ADD KEY idx_posts_tenant_moderation (tenant_id, moderation_state)",
    ],
  ]);
  await addIndexes("comments", [
    [
      "idx_comments_moderation",
      "ADD KEY idx_comments_moderation (tenant_id, moderation_state)",
    ],
  ]);

  // Burst counters. Keyed by an opaque scope string ("t:12:h", "v:<hash>:12:h",
  // "d:gmail.com:12:d") plus the window start, so one table serves every cap.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public_write_counters (
      scope_key VARCHAR(100) NOT NULL,
      window_start DATETIME NOT NULL,
      count INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (scope_key, window_start),
      KEY idx_write_counters_window (window_start)
    ) ENGINE=InnoDB
  `);
  console.log("public_write_counters ready");

  await pool.end();
})().catch((e) => {
  console.error("migration error:", e.message);
  process.exit(1);
});
