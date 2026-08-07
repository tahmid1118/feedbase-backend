/**
 * Record MODERATOR OVERRIDES so spam weights can be calibrated from real data
 * instead of guessed. Idempotent. Mirrored in feedboard_db.sql.
 *
 *   node scripts/add-spam-review-columns.js
 *
 * WHY. The scorer's weights were chosen by judgement, and the expensive failure
 * mode (quarantining real feedback) is invisible from the server's side — we
 * only ever see what we scored, never whether we were right.
 *
 * A moderator clicking "Not spam" IS the ground truth: it is a human labelling
 * that item a false positive. Marking it published clears `spam_score` (so it
 * leaves the queue), which would otherwise destroy exactly the number we need.
 * These two columns preserve it:
 *
 *   spam_reviewed_at    — when a human overrode the classifier
 *   spam_reviewed_score — the score it had at that moment
 *
 * scripts/spam-report.js then reports a real false-positive rate per score band,
 * which is what tells you where SPAM_SCORE_HIDE actually belongs.
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

const COLUMNS = [
  ["spam_reviewed_at", "ADD COLUMN spam_reviewed_at DATETIME NULL"],
  [
    "spam_reviewed_score",
    "ADD COLUMN spam_reviewed_score TINYINT UNSIGNED NULL",
  ],
];

(async () => {
  for (const table of ["posts", "comments"]) {
    for (const [col, clause] of COLUMNS) {
      if (await hasColumn(table, col)) {
        console.log(`${table}.${col} already exists — skipping`);
      } else {
        await pool.query(`ALTER TABLE ${table} ${clause}`);
        console.log(`added ${table}.${col}`);
      }
    }
  }
  await pool.end();
})().catch((e) => {
  console.error("migration error:", e.message);
  process.exit(1);
});
