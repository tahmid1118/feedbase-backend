/**
 * Make "one redemption per account, per promo code" enforceable by the DATABASE
 * rather than by a check-then-insert in application code.
 *
 * Adds `promo_redemptions.account_email` (billing is per account/email, not per
 * user row or workspace) and a UNIQUE index on (promo_code_id, account_email).
 * With the unique index in place, a second redemption fails with ER_DUP_ENTRY
 * even if two requests race past the same SELECT at the same instant.
 *
 * Existing rows are backfilled from the redeeming user's email.
 * Idempotent. Mirrored in database/schema.sql — keep the two in step: a fresh
 * install is built from that file alone, so a column that lives only here is a
 * database the running code cannot use.
 *
 *   node scripts/add-promo-redemption-uniqueness.js
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

const hasColumn = async (table, column) => {
  const [r] = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return r.length > 0;
};
const hasIndex = async (table, index) => {
  const [r] = await pool.query(
    `SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, index]
  );
  return r.length > 0;
};

(async () => {
  if (await hasColumn("promo_redemptions", "account_email")) {
    console.log("promo_redemptions.account_email already exists — skipping");
  } else {
    await pool.query(
      "ALTER TABLE promo_redemptions ADD COLUMN account_email VARCHAR(255) NULL AFTER redeemed_by_user_id"
    );
    console.log("added promo_redemptions.account_email");
  }

  // Backfill from the redeeming user so historical rows participate in the
  // uniqueness rule instead of being invisible to it.
  const [res] = await pool.query(
    `UPDATE promo_redemptions r
       JOIN users u ON u.id = r.redeemed_by_user_id
        SET r.account_email = u.email
      WHERE r.account_email IS NULL`
  );
  console.log(`backfilled account_email on ${res.affectedRows} row(s)`);

  // Surface any duplicates that already exist — the index cannot be created
  // until they are resolved, and silently dropping data is not acceptable.
  const [dupes] = await pool.query(
    `SELECT promo_code_id, account_email, COUNT(*) c
       FROM promo_redemptions
      WHERE account_email IS NOT NULL
      GROUP BY promo_code_id, account_email HAVING c > 1`
  );
  if (dupes.length) {
    console.error("\nCannot add the unique index — these (promo_code_id, account_email) pairs are already duplicated:");
    for (const d of dupes) console.error(`  promo_code_id=${d.promo_code_id} email=${d.account_email} count=${d.c}`);
    console.error("Resolve them (keep the earliest row) and re-run.");
    await pool.end();
    process.exit(1);
  }

  if (await hasIndex("promo_redemptions", "uq_promo_account")) {
    console.log("index uq_promo_account already exists — skipping");
  } else {
    await pool.query(
      "ALTER TABLE promo_redemptions ADD UNIQUE KEY uq_promo_account (promo_code_id, account_email)"
    );
    console.log("added unique index uq_promo_account (promo_code_id, account_email)");
  }
  await pool.end();
})().catch((e) => {
  console.error("migration error:", e.message);
  process.exit(1);
});
