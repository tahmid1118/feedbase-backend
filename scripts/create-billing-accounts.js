/**
 * Create the `billing_accounts` table — the source of truth for subscriptions,
 * which are now per ACCOUNT (email), not per workspace. One account = one Stripe
 * customer/subscription (or comp), and its plan is mirrored onto every workspace
 * the account OWNS (see src/common/accountBilling.js). Idempotent (CREATE TABLE
 * IF NOT EXISTS). Mirrored in feedboard_db.sql.
 *
 *   node scripts/create-billing-accounts.js
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_accounts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email VARCHAR(190) NOT NULL,
      plan_name VARCHAR(50) NOT NULL DEFAULT 'free',
      stripe_customer_id VARCHAR(255) NULL,
      stripe_subscription_id VARCHAR(255) NULL,
      subscription_status VARCHAR(50) NULL,
      billing_interval ENUM('month', 'year') NULL,
      current_period_end DATETIME NULL,
      pending_plan VARCHAR(20) NULL,
      pending_interval ENUM('month', 'year') NULL,
      pending_effective_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_billing_accounts_email (email),
      KEY idx_billing_accounts_customer (stripe_customer_id),
      KEY idx_billing_accounts_subscription (stripe_subscription_id)
    ) ENGINE=InnoDB
  `);
  console.log("billing_accounts ready.");
  await pool.end();
})().catch((e) => {
  console.error("migration error:", e.message);
  process.exit(1);
});
