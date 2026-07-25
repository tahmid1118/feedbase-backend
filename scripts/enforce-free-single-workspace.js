/**
 * Enforce the FREE-tier rule of ONE workspace per account. Free accounts are
 * capped at owning 1 workspace (src/consts/plans.js `ownWorkspaces: 1`, enforced
 * on create). This one-off cleans up any FREE account that already owns MORE than
 * one: it KEEPS the first (oldest) workspace and DELETES the rest (cascades to
 * their posts/users/comments/etc. via FK ON DELETE CASCADE).
 *
 *   node scripts/enforce-free-single-workspace.js          # dry run (prints plan)
 *   node scripts/enforce-free-single-workspace.js --apply  # actually delete
 *
 * Pro/Business accounts (which may own several) are untouched.
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

const APPLY = process.argv.includes("--apply");

(async () => {
  // Every active workspace with its owner email + the owner's account plan.
  const [rows] = await pool.query(
    `SELECT t.id, t.subdomain, t.created_at,
            (SELECT email FROM users WHERE tenant_id = t.id AND role = 'owner' AND is_active = 1 LIMIT 1) AS owner,
            COALESCE(ba.plan_name, 'free') AS plan_name
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'owner' AND u.is_active = 1
       LEFT JOIN billing_accounts ba ON ba.email = u.email
      WHERE t.is_active = 1
      GROUP BY t.id`
  );

  // Group by owner; only FREE accounts owning >1 are affected.
  const byOwner = new Map();
  for (const r of rows) {
    if (!r.owner) continue;
    if (!byOwner.has(r.owner)) byOwner.set(r.owner, []);
    byOwner.get(r.owner).push(r);
  }

  const toDelete = [];
  for (const [owner, owned] of byOwner) {
    const plan = owned[0].plan_name;
    if (plan !== "free" || owned.length <= 1) continue;
    // Keep the oldest (first created); delete the rest.
    owned.sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);
    const keep = owned[0];
    const drop = owned.slice(1);
    console.log(
      `${owner} (free): keep #${keep.id} "${keep.subdomain}", delete ${drop
        .map((d) => `#${d.id} "${d.subdomain}"`)
        .join(", ")}`
    );
    toDelete.push(...drop.map((d) => d.id));
  }

  if (toDelete.length === 0) {
    console.log("Nothing to clean up — every free account already owns ≤1 workspace.");
  } else if (!APPLY) {
    console.log(`\nDRY RUN — ${toDelete.length} workspace(s) would be deleted. Re-run with --apply to delete.`);
  } else {
    await pool.query("DELETE FROM tenants WHERE id IN (?)", [toDelete]);
    console.log(`\nDeleted ${toDelete.length} workspace(s).`);
  }

  await pool.end();
})().catch((e) => {
  console.error("cleanup error:", e.message);
  process.exit(1);
});
