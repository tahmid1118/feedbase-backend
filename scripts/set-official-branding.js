/**
 * Set FeedBoard's brand icon as:
 *   - the platform admin's profile picture (all `users` rows for the admin email)
 *   - the official feedback board's logo (`tenants.branding_logo_url`)
 *
 *   node scripts/set-official-branding.js [subdomain]
 *
 * Defaults the board subdomain to "feedback". Idempotent — safe to re-run; it
 * copies the icon into the served uploads tree and points both the admin avatar
 * and the board logo at it. Because the admin avatar is the app icon, the admin's
 * comments render the app icon as their avatar (the reads return `author_avatar`).
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");
const { ensureBrandAsset } = require("../src/common/brand-asset");

const SUBDOMAIN = (process.argv[2] || "feedback").toLowerCase();

(async () => {
  const logoPath = ensureBrandAsset();
  console.log(`brand asset ready at ${logoPath}`);

  // 1. The platform-admin account(s) — set the app icon on every users row that
  //    shares the admin's email (their profile picture across all workspaces).
  const [admins] = await pool.query(
    `SELECT DISTINCT email FROM users WHERE is_platform_admin = 1 AND is_active = 1`
  );
  if (admins.length === 0) {
    throw new Error("No platform-admin account found — run scripts/create-admin.js first.");
  }
  for (const { email } of admins) {
    const [r] = await pool.query(
      `UPDATE users SET avatar_url = ? WHERE email = ?`,
      [logoPath, email]
    );
    console.log(`admin ${email}: set avatar on ${r.affectedRows} row(s)`);
  }

  // 2. The official feedback board's logo.
  const [tenants] = await pool.query(
    `SELECT id, name FROM tenants WHERE subdomain = ?`,
    [SUBDOMAIN]
  );
  if (tenants.length === 0) {
    console.warn(
      `No tenant with subdomain "${SUBDOMAIN}" — run scripts/create-official-board.js first (logo not set).`
    );
  } else {
    await pool.query(`UPDATE tenants SET branding_logo_url = ? WHERE id = ?`, [
      logoPath,
      tenants[0].id,
    ]);
    console.log(`official board "${SUBDOMAIN}" (id=${tenants[0].id}): set logo`);
  }

  await pool.end();
  console.log("done.");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
