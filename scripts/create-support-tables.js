/**
 * One-off migration: create the support-chat tables (`support_sessions`,
 * `support_messages`). Run once from the backend root:
 *
 *   node scripts/create-support-tables.js
 *
 * A support session is a conversation between one tenant user and the platform
 * admin. The admin closes a session when done; after that the user can no longer
 * see it, but the admin keeps the transcript forever — so nothing here cascades
 * from users/tenants (user_id/tenant_id are SET NULL on delete, and the display
 * identity is denormalized so history survives an account deletion). Mirrored in
 * feedboard_db.sql. Idempotent (CREATE TABLE IF NOT EXISTS).
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tenant_id BIGINT UNSIGNED NULL,
      user_id BIGINT UNSIGNED NULL,
      user_email VARCHAR(255) NOT NULL,
      user_name VARCHAR(160) NULL,
      status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_message_at DATETIME NULL,
      user_last_read_at DATETIME NULL,
      admin_last_read_at DATETIME NULL,
      closed_at DATETIME NULL,
      closed_by_admin_id BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      KEY idx_support_sessions_user_status (user_id, status),
      KEY idx_support_sessions_status_last (status, last_message_at),
      CONSTRAINT fk_support_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
      CONSTRAINT fk_support_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_support_sessions_admin FOREIGN KEY (closed_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
  console.log("support_sessions ready.");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      session_id BIGINT UNSIGNED NOT NULL,
      sender ENUM('user', 'admin') NOT NULL,
      sender_user_id BIGINT UNSIGNED NULL,
      sender_admin_id BIGINT UNSIGNED NULL,
      body TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_support_messages_session (session_id, created_at),
      CONSTRAINT fk_support_messages_session FOREIGN KEY (session_id) REFERENCES support_sessions(id) ON DELETE CASCADE,
      CONSTRAINT fk_support_messages_user FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_support_messages_admin FOREIGN KEY (sender_admin_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
  console.log("support_messages ready.");

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
