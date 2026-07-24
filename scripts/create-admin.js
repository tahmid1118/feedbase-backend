/**
 * Grant the platform-admin role to an account. Run from the backend root:
 *
 *   node scripts/create-admin.js <email> <password> [fullName]
 *   # or via env: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME
 *
 * "Platform admin" is a ROLE on a `users` account (`users.is_platform_admin`),
 * not a separate table. If the email already has a `users` account this flags it
 * (the given password is applied so the operator can rely on it at /admin-login);
 * otherwise a pending admin user is created. Bootstrap the first admin here;
 * further admins are granted from the Admin Panel.
 */
require("dotenv").config();
const bcrypt = require("bcrypt");
const { pool } = require("../database/dbPool");

const email = (process.env.SEED_ADMIN_EMAIL || process.argv[2] || "")
  .toLowerCase()
  .trim();
const password = process.env.SEED_ADMIN_PASSWORD || process.argv[3] || "";
const fullName = process.env.SEED_ADMIN_NAME || process.argv[4] || "Administrator";

(async () => {
  if (!email || !password) {
    console.error("Usage: node scripts/create-admin.js <email> <password> [fullName]");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);

  if (existing.length > 0) {
    // Grant the role across the account's rows and sync the password.
    await pool.query(
      "UPDATE users SET is_platform_admin = 1, password_hash = ? WHERE email = ?",
      [passwordHash, email]
    );
    console.log(`Granted platform-admin to existing account ${email} (${existing.length} row(s)).`);
  } else {
    const [ins] = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role, is_active, is_platform_admin)
       VALUES (NULL, ?, ?, ?, 'user', 1, 1)`,
      [email, passwordHash, fullName]
    );
    console.log(`Created pending admin user ${email} (id=${ins.insertId}).`);
  }

  const [rows] = await pool.query(
    "SELECT id, email, full_name, tenant_id, is_active, is_platform_admin FROM users WHERE email = ?",
    [email]
  );
  console.log("Admin account rows:", rows);
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
