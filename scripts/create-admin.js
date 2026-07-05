/**
 * Seed / update a platform admin (the app operator). Run from the backend root:
 *
 *   node scripts/create-admin.js <email> <password> [fullName]
 *   # or via env: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME
 *
 * Admins are stored in the `admins` table, separate from tenant `users`, so the
 * same email may exist in both. Bootstrap the FIRST admin with this script;
 * subsequent admins are created from the Admin Panel.
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
    console.error(
      "Usage: node scripts/create-admin.js <email> <password> [fullName]"
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO admins (email, password_hash, full_name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       full_name = VALUES(full_name),
       is_active = 1`,
    [email, passwordHash, fullName]
  );

  const [rows] = await pool.query(
    "SELECT id, email, full_name, is_active FROM admins WHERE email = ?",
    [email]
  );
  console.log("Admin ready:", rows[0]);
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
