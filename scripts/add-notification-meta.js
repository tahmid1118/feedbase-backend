/**
 * One-off migration: add `meta` to the `notifications` table.
 *
 *   node scripts/add-notification-meta.js
 *
 * Notification `title`/`message` are written in English at creation time, so a
 * stored row cannot be translated when it is later read by a user whose UI is
 * in another language. `meta` holds the structured pieces instead
 * (e.g. {"key":"comment","postTitle":"…","who":"…","body":"…"}) so the client
 * can render the text in the reader's language via i18n.
 *
 * `title`/`message` are kept as the English fallback for rows written before
 * this column existed (and for any non-i18n consumer). Mirrored in
 * feedbase_db.sql. Idempotent.
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

(async () => {
  const [cols] = await pool.query("SHOW COLUMNS FROM notifications LIKE 'meta'");
  if (cols.length === 0) {
    await pool.query("ALTER TABLE notifications ADD COLUMN meta JSON NULL AFTER message");
    console.log("added notifications.meta");
  } else {
    console.log("notifications.meta already present");
  }

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
