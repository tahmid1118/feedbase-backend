/**
 * Add `paddle_discount_id` to `offers` and `promo_codes`. Promotional offers and
 * percent-off promo codes are backed by a provider discount (a Stripe coupon or a
 * Paddle discount) auto-applied at checkout; each provider keeps its own id column
 * so both can coexist behind BILLING_PROVIDER. The stripe_* columns are preserved.
 * Idempotent. Mirrored in feedboard_db.sql.
 *
 *   node scripts/add-paddle-discount-columns.js
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

(async () => {
  const adds = [
    ["offers", "paddle_discount_id", "ADD COLUMN paddle_discount_id VARCHAR(255) NULL AFTER stripe_coupon_id"],
    ["promo_codes", "paddle_discount_id", "ADD COLUMN paddle_discount_id VARCHAR(255) NULL AFTER stripe_promotion_code_id"],
  ];
  for (const [table, col, clause] of adds) {
    if (await hasColumn(table, col)) {
      console.log(`${table}.${col} already exists — skipping`);
    } else {
      await pool.query(`ALTER TABLE ${table} ${clause}`);
      console.log(`added ${table}.${col}`);
    }
  }
  await pool.end();
})().catch((e) => {
  console.error("migration error:", e.message);
  process.exit(1);
});
