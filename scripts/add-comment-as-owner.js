/**
 * Adds `comments.as_owner` — when a board OWNER posts a comment they may choose
 * to show as "Owner" (with a verified tick) instead of their real name. The flag
 * records that choice; the read handlers then hide the real name/avatar and the
 * client renders the localized "Owner" label + tick. Idempotent. Mirrored in
 * feedboard_db.sql.
 *
 *   node scripts/add-comment-as-owner.js
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

(async () => {
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'comments'
          AND column_name = 'as_owner' LIMIT 1`
    );
    if (rows.length > 0) {
      console.log("comments.as_owner already exists — skipping");
    } else {
      await pool.query(
        "ALTER TABLE comments ADD COLUMN as_owner TINYINT(1) NOT NULL DEFAULT 0 AFTER guest_id"
      );
      console.log("added comments.as_owner");
    }
    await pool.end();
  } catch (e) {
    console.error("migration error:", e.message);
    process.exit(1);
  }
})();
