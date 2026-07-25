/**
 * One-off: create FeedBoard's OWN public feedback board — the workspace where
 * users of this app report bugs and request features (dogfooding).
 *
 *   node scripts/create-official-board.js [subdomain] [name]
 *
 * Defaults to subdomain "feedback", name "FeedBoard".
 *
 * The workspace is owned by the platform admin's own account: it copies the
 * `users` row that already exists for the admin's email, so the admin signs in
 * with their normal password and finds it in the workspace switcher. (The
 * `admins` table is a separate identity from tenant `users` and cannot own a
 * workspace directly.) Platform admins can also moderate it from
 * /admin/workspaces/<id> like any other workspace.
 *
 * Comped to the Business plan so the board itself has every capability
 * (attachments, contacting submitters, …) without a Stripe subscription.
 *
 * Idempotent: re-running reports what already exists and repairs a missing
 * owner row or roadmap columns rather than duplicating anything.
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");
const { ensureBrandAsset } = require("../src/common/brand-asset");

const SUBDOMAIN = (process.argv[2] || "feedback").toLowerCase();
const NAME = process.argv[3] || "FeedBoard";

// Mirrors proxy.ts RESERVED_SUBDOMAINS — these never route to a portal.
const RESERVED = new Set(["www", "app", "admin", "dashboard", "api"]);

(async () => {
  if (RESERVED.has(SUBDOMAIN)) {
    throw new Error(
      `"${SUBDOMAIN}" is a reserved subdomain (proxy.ts routes it to the app, not a portal).`
    );
  }

  // 1. The platform-admin account (a `users` row flagged is_platform_admin) that
  //    will own the board. Platform admin is now a role on the users account.
  const [accounts] = await pool.query(
    `SELECT id, email, password_hash, full_name, avatar_url
       FROM users
      WHERE is_platform_admin = 1 AND is_active = 1 AND password_hash IS NOT NULL
      ORDER BY id LIMIT 1`
  );
  if (accounts.length === 0) {
    throw new Error(
      "No platform-admin account found — run scripts/create-admin.js first."
    );
  }
  const account = accounts[0];
  const admin = account;

  // FeedBoard's brand icon — used as the board's logo and the admin's avatar so
  // the app icon represents the platform on the official board and in comments.
  const logoPath = ensureBrandAsset();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 3. Tenant (reuse if the subdomain is already taken by a previous run).
    let [existing] = await conn.query("SELECT id, name FROM tenants WHERE subdomain = ?", [SUBDOMAIN]);
    let tenantId;
    if (existing.length > 0) {
      tenantId = existing[0].id;
      console.log(`tenant "${SUBDOMAIN}" already exists (id=${tenantId}) — reusing`);
      await conn.query("UPDATE tenants SET branding_logo_url = ? WHERE id = ?", [logoPath, tenantId]);
    } else {
      const [t] = await conn.query(
        `INSERT INTO tenants
           (name, slug, subdomain, custom_domain, website, plan_name,
            subscription_status, branding_logo_url, branding_primary_color, is_active)
         VALUES (?, ?, ?, NULL, NULL, 'business', 'comped', ?, '#c74959', 1)`,
        [NAME, SUBDOMAIN, SUBDOMAIN, logoPath]
      );
      tenantId = t.insertId;
      console.log(`created tenant "${SUBDOMAIN}" (id=${tenantId}) on Business (comped)`);
    }

    // 4. Owner row for the admin's account.
    const [owner] = await conn.query(
      "SELECT id FROM users WHERE tenant_id = ? AND email = ?",
      [tenantId, admin.email]
    );
    if (owner.length > 0) {
      console.log(`owner ${admin.email} already present (user id=${owner[0].id})`);
    } else {
      const [o] = await conn.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, role, avatar_url, is_active)
         VALUES (?, ?, ?, ?, 'owner', ?, 1)`,
        [tenantId, account.email, account.password_hash, account.full_name, logoPath]
      );
      console.log(`added owner ${admin.email} (user id=${o.insertId})`);
    }

    // The app icon is the platform admin's profile picture across every workspace
    // they belong to, so their comments render it as their avatar.
    const [av] = await conn.query("UPDATE users SET avatar_url = ? WHERE email = ?", [logoPath, admin.email]);
    console.log(`set admin avatar (app icon) on ${av.affectedRows} row(s)`);

    // 5. Default roadmap columns (same three createWorkspace seeds).
    const [cols] = await conn.query(
      "SELECT COUNT(*) AS n FROM roadmap_columns WHERE tenant_id = ?",
      [tenantId]
    );
    if (cols[0].n === 0) {
      await conn.query(
        `INSERT INTO roadmap_columns (tenant_id, name, column_key, sort_order) VALUES
          (?, 'Planned', 'planned', 1),
          (?, 'In Progress', 'in_progress', 2),
          (?, 'Completed', 'completed', 3)`,
        [tenantId, tenantId, tenantId]
      );
      console.log("seeded roadmap columns");
    } else {
      console.log(`roadmap columns already present (${cols[0].n})`);
    }

    await conn.commit();

    const root = process.env.ROOT_DOMAIN || "localhost:3000";
    console.log("\nOfficial board ready:");
    console.log(`  tenant id     ${tenantId}`);
    console.log(`  owner         ${admin.email}`);
    console.log(`  public board  http://${SUBDOMAIN}.${root}`);
    console.log(`  direct path   http://${root}/portal/${SUBDOMAIN}`);
    console.log(`  moderate at   /admin/workspaces/${tenantId}`);
    console.log(`\nSet NEXT_PUBLIC_FEEDBACK_SUBDOMAIN=${SUBDOMAIN} in the frontend .env.local`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
