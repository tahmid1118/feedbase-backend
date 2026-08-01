#!/usr/bin/env node
/**
 * Re-shape `oauth_accounts` for the per-ACCOUNT model.
 *
 * The original table was written for the old single-tenant world: it keyed the
 * provider link on `(tenant_id, provider, provider_user_id)` with NOT NULL FKs
 * to `tenants` and `users`. Two things break under the current model:
 *
 *   - A signed-up account has NO workspace until onboarding (`users.tenant_id`
 *     is NULL), so there is no tenant to key on at the moment of first login.
 *   - An account is an EMAIL that may hold a `users` row in several workspaces.
 *     A Google identity belongs to the person, not to one of their memberships,
 *     so linking it per tenant would re-link on every workspace they join.
 *
 * The link is therefore keyed by EMAIL and unique on `(provider,
 * provider_user_id)` — the same account-level shape `user_sessions`,
 * `password_resets` and `billing_accounts` already use, and like them it holds
 * no FK to `users` (the row must survive a workspace-less account).
 *
 * Idempotent. Refuses to touch a table that has rows, so it can never discard
 * real links — if that ever fires, migrate the data by hand.
 *
 *   node scripts/rebuild-oauth-accounts.js
 */

require("dotenv").config();
const { pool } = require("../database/dbPool");

const CREATE = `
CREATE TABLE oauth_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- The ACCOUNT this provider identity signs in to. Not a users.id: the account
  -- may own rows in several workspaces, or none at all before onboarding.
  email VARCHAR(190) NOT NULL,
  provider ENUM('google', 'facebook', 'github', 'microsoft') NOT NULL,
  -- The provider's stable subject id. This, not the email, is the identity:
  -- a person can change their Google address and must stay the same account.
  provider_user_id VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_oauth_provider_user (provider, provider_user_id),
  KEY idx_oauth_email (email)
) ENGINE=InnoDB`;

const main = async () => {
  const [[{ db }]] = await pool.query("SELECT DATABASE() AS db");
  const [exists] = await pool.query(
    "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'oauth_accounts'",
    [db]
  );

  if (exists.length > 0) {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'oauth_accounts' AND COLUMN_NAME = 'email'`,
      [db]
    );
    if (cols.length > 0) {
      console.log("oauth_accounts already in the account-keyed shape — nothing to do.");
      await pool.end();
      return;
    }

    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM oauth_accounts");
    if (n > 0) {
      console.error(
        `REFUSING: oauth_accounts holds ${n} row(s) in the old tenant-keyed shape.\n` +
          "Migrate them by hand — this script will not discard existing provider links."
      );
      await pool.end();
      process.exit(1);
    }

    await pool.query("DROP TABLE oauth_accounts");
    console.log("dropped the empty tenant-keyed oauth_accounts");
  }

  await pool.query(CREATE);
  console.log("created account-keyed oauth_accounts (unique on provider + provider_user_id)");
  await pool.end();
};

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
