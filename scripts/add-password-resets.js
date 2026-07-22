/**
 * One-off migration: create the `password_resets` table.
 *
 *   node scripts/add-password-resets.js
 *
 * Backs the self-service "forgot password" flow. A request stores a SHA-256
 * HASH of a random token (never the raw token — a DB read must not grant the
 * ability to reset a password), keyed by account EMAIL (an account may own
 * several `users` rows, all sharing one password hash). Tokens are single-use
 * and expire after 1 hour. Mirrored in feedbase_db.sql. Idempotent.
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

(async () => {
  const [tables] = await pool.query("SHOW TABLES LIKE 'password_resets'");
  if (tables.length > 0) {
    console.log("password_resets already present");
    await pool.end();
    return;
  }

  await pool.query(`
    CREATE TABLE password_resets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email VARCHAR(190) NOT NULL,
      token_hash VARCHAR(64) NOT NULL,
      status ENUM('pending', 'used') NOT NULL DEFAULT 'pending',
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      requested_ip VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_password_resets_token (token_hash),
      KEY idx_password_resets_email (email, status)
    ) ENGINE=InnoDB
  `);
  console.log("created password_resets");

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
