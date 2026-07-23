/**
 * One-off migration: add `billing_interval` to the `offers` table so an offer
 * can target the MONTHLY or the YEARLY price (previously monthly-only). Run once
 * from the backend root:
 *
 *   node scripts/add-offer-interval.js
 *
 * Existing offers default to 'month' (their prior behavior). Mirrored in
 * feedboard_db.sql. Idempotent.
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

(async () => {
  const [cols] = await pool.query("SHOW COLUMNS FROM offers LIKE 'billing_interval'");
  if (cols.length === 0) {
    await pool.query(
      "ALTER TABLE offers ADD COLUMN billing_interval ENUM('month','year') NOT NULL DEFAULT 'month' AFTER plan"
    );
    console.log("added offers.billing_interval");
  } else {
    console.log("offers.billing_interval already present");
  }

  // Widen the lookup index to (plan, billing_interval, is_active).
  const [idx] = await pool.query("SHOW INDEX FROM offers WHERE Key_name = 'idx_offers_active'");
  if (idx.length && !idx.some((i) => i.Column_name === "billing_interval")) {
    await pool.query("ALTER TABLE offers DROP INDEX idx_offers_active");
    await pool.query(
      "ALTER TABLE offers ADD INDEX idx_offers_active (plan, billing_interval, is_active)"
    );
    console.log("rebuilt idx_offers_active to include billing_interval");
  }

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
