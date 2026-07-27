/**
 * Add Paddle columns to `billing_accounts`. Subscriptions can be served by either
 * provider (see BILLING_PROVIDER); the shared plan/status/interval/period columns
 * stay provider-agnostic and mirrored to tenants, while each provider keeps its own
 * customer/subscription ids. The stripe_* columns are preserved (Stripe dormant).
 * Idempotent. Mirrored in feedboard_db.sql.
 *
 *   node scripts/add-paddle-columns.js
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
    ["paddle_customer_id", "ADD COLUMN paddle_customer_id VARCHAR(255) NULL AFTER stripe_subscription_id"],
    ["paddle_subscription_id", "ADD COLUMN paddle_subscription_id VARCHAR(255) NULL AFTER paddle_customer_id"],
  ];
  for (const [col, clause] of adds) {
    if (await hasColumn("billing_accounts", col)) {
      console.log(`billing_accounts.${col} already exists — skipping`);
    } else {
      await pool.query(`ALTER TABLE billing_accounts ${clause}`);
      console.log(`added billing_accounts.${col}`);
    }
  }

  const hasIndex = async (table, index) => {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
      [table, index]
    );
    return rows.length > 0;
  };
  const indexes = [
    ["idx_billing_accounts_paddle_customer", "ADD KEY idx_billing_accounts_paddle_customer (paddle_customer_id)"],
    ["idx_billing_accounts_paddle_subscription", "ADD KEY idx_billing_accounts_paddle_subscription (paddle_subscription_id)"],
  ];
  for (const [idx, clause] of indexes) {
    if (await hasIndex("billing_accounts", idx)) {
      console.log(`index ${idx} already exists — skipping`);
    } else {
      await pool.query(`ALTER TABLE billing_accounts ${clause}`);
      console.log(`added index ${idx}`);
    }
  }
  await pool.end();
})().catch((e) => {
  console.error("migration error:", e.message);
  process.exit(1);
});
