/**
 * Migrate platform-admin identity from the separate `admins` table onto the
 * `users` account as a role flag. ADDITIVE + idempotent — it does NOT drop the
 * `admins` table (that happens later, only after the app is verified on the new
 * model). Safe to re-run.
 *
 *   node scripts/merge-admins-into-users.js
 *
 * For every admin:
 *   - flag every `users` row sharing that email as a platform admin, and
 *   - copy the admin's password_hash onto those rows, so the credential used at
 *     /admin-login keeps working once /admin-login authenticates against `users`.
 *   - if the admin has NO users row, create a pending one (tenant_id NULL).
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
};

const indexExists = async (table, indexName) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
};

(async () => {
  try {
    // 1. Column
    if (await columnExists("users", "is_platform_admin")) {
      console.log("users.is_platform_admin already exists — skipping ADD");
    } else {
      await pool.query(
        "ALTER TABLE users ADD COLUMN is_platform_admin TINYINT(1) NOT NULL DEFAULT 0"
      );
      console.log("added users.is_platform_admin");
    }

    // 2. Index
    if (await indexExists("users", "idx_users_platform_admin")) {
      console.log("idx_users_platform_admin already exists — skipping");
    } else {
      await pool.query(
        "ALTER TABLE users ADD KEY idx_users_platform_admin (is_platform_admin)"
      );
      console.log("added idx_users_platform_admin");
    }

    // 3. Does the admins table still exist? (After the final drop it won't; the
    //    flag is already migrated, so this becomes a no-op — still idempotent.)
    const [[{ n: hasAdmins }]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'admins'`
    );
    if (!hasAdmins) {
      console.log("admins table no longer present — nothing to migrate");
      await pool.end();
      return;
    }

    const [admins] = await pool.query(
      "SELECT id, email, full_name, password_hash FROM admins"
    );
    console.log(`\nmigrating ${admins.length} admin(s):`);
    for (const a of admins) {
      const [res] = await pool.query(
        "UPDATE users SET is_platform_admin = 1, password_hash = ? WHERE email = ?",
        [a.password_hash, a.email]
      );
      if (res.affectedRows > 0) {
        console.log(`  ${a.email}: flagged ${res.affectedRows} users row(s) + synced password`);
      } else {
        // No users account for this admin — create a pending one so they can log in.
        const [ins] = await pool.query(
          `INSERT INTO users (tenant_id, email, password_hash, full_name, role, is_active, is_platform_admin)
           VALUES (NULL, ?, ?, ?, 'user', 1, 1)`,
          [a.email, a.password_hash, a.full_name]
        );
        console.log(`  ${a.email}: no users row — created pending admin user id=${ins.insertId}`);
      }
    }

    console.log("\n=== result: users flagged as platform admin ===");
    const [flagged] = await pool.query(
      "SELECT id, email, tenant_id, is_platform_admin FROM users WHERE is_platform_admin = 1 ORDER BY email, id"
    );
    for (const u of flagged) console.log(`  id=${u.id} tenant=${u.tenant_id} ${u.email}`);

    await pool.end();
  } catch (e) {
    console.error("migration error:", e.message);
    process.exit(1);
  }
})();
