/**
 * Adds `tenants.require_auth_to_post` — a Pro+ setting letting the workspace
 * owner require that feedback submitters be signed in, instead of the default
 * guest/anonymous submission (title + contact email only). Default 0
 * (anonymous posting allowed) so every EXISTING workspace's behavior is
 * unchanged by this migration. Enforcement re-checks the plan on every write
 * (see createPublicPost.js) — a downgrade silently reverts to "allowed" rather
 * than locking real feedback out, matching every other plan-gated toggle in
 * this codebase. Idempotent. Mirrored in feedboard_db.sql. Runs automatically
 * at boot (src/common/bootMigrations.js) — keep additive.
 *
 *   node scripts/add-require-auth-to-post.js
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

(async () => {
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'tenants'
          AND column_name = 'require_auth_to_post' LIMIT 1`
    );
    if (rows.length > 0) {
      console.log("tenants.require_auth_to_post already exists — skipping");
    } else {
      await pool.query(
        "ALTER TABLE tenants ADD COLUMN require_auth_to_post TINYINT(1) NOT NULL DEFAULT 0 AFTER branding_primary_color"
      );
      console.log("added tenants.require_auth_to_post");
    }
    await pool.end();
  } catch (e) {
    console.error("migration error:", e.message);
    process.exit(1);
  }
})();
