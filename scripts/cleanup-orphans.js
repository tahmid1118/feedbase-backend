#!/usr/bin/env node
/**
 * Repair data the OLD row-scoped admin delete left behind, and close the
 * lockout hole that made deleting a platform admin catastrophic.
 *
 * Two independent repairs, both idempotent:
 *
 * 1. OWNERLESS WORKSPACES. `DELETE FROM users WHERE id = ?` (the admin panel's
 *    old delete) removed an owner and left their workspace alive with nobody
 *    able to administer it. Such a tenant is unreachable — no one can open its
 *    dashboard, change its plan, or delete it through the app.
 *
 * 2. PLATFORM-ADMIN FLAG DRIFT. `users.is_platform_admin` is meant to be a
 *    property of the ACCOUNT (manageAdmins.js sets it `WHERE email = ?`), but
 *    rows created later — by onboarding or create-official-board — start at 0.
 *    Both /admin-login and authenticateAdmin look up `email = ? AND
 *    is_platform_admin = 1`, so if the one flagged row were ever removed the
 *    operator would be locked out of the admin panel with no way back in.
 *    Backfilling the flag across the account's rows removes that single point
 *    of failure.
 *
 * Reports by default; pass --fix to apply.
 *
 *   node scripts/cleanup-orphans.js
 *   node scripts/cleanup-orphans.js --fix
 */

require("dotenv").config();
const { pool } = require("../database/dbPool");

const APPLY = process.argv.includes("--fix");

const main = async () => {
  let issues = 0;

  console.log(APPLY ? "MODE: apply (--fix)\n" : "MODE: report only (pass --fix to apply)\n");

  // ---- 1. Workspaces with no owner ----------------------------------------
  const [orphans] = await pool.query(
    `SELECT t.id, t.name, t.subdomain, t.plan_name,
            (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS members,
            (SELECT COUNT(*) FROM posts p WHERE p.tenant_id = t.id) AS posts
       FROM tenants t
      WHERE NOT EXISTS (
        SELECT 1 FROM users u WHERE u.tenant_id = t.id AND u.role = 'owner'
      )`
  );

  console.log(`Ownerless workspaces: ${orphans.length}`);
  for (const t of orphans) {
    issues += 1;
    console.log(
      `  - #${t.id} ${t.name} (${t.subdomain}) plan=${t.plan_name} members=${t.members} posts=${t.posts}`
    );
    // A workspace that still has members or content is NOT safe to delete
    // unattended — someone's data is in it. Surface it and let a human decide.
    if (t.members > 0 || t.posts > 0) {
      console.log("      SKIP: has members or posts — resolve manually");
      continue;
    }
    if (APPLY) {
      await pool.query("DELETE FROM tenants WHERE id = ?", [t.id]);
      console.log("      deleted (empty)");
    }
  }

  // ---- 2. Platform-admin flag drift ---------------------------------------
  const [drift] = await pool.query(
    `SELECT u.id, u.email, u.tenant_id
       FROM users u
      WHERE u.is_platform_admin = 0
        AND EXISTS (
          SELECT 1 FROM users a
           WHERE a.email = u.email AND a.is_platform_admin = 1
        )`
  );

  console.log(`\nAdmin accounts with unflagged rows: ${drift.length}`);
  for (const r of drift) {
    issues += 1;
    console.log(`  - users#${r.id} ${r.email} (tenant ${r.tenant_id ?? "none"})`);
  }
  if (APPLY && drift.length > 0) {
    const [res] = await pool.query(
      `UPDATE users u
          SET u.is_platform_admin = 1
        WHERE u.is_platform_admin = 0
          AND EXISTS (
            SELECT 1 FROM (SELECT email FROM users WHERE is_platform_admin = 1) a
             WHERE a.email = u.email
          )`
    );
    console.log(`  flagged ${res.affectedRows} row(s)`);
  }

  console.log(
    issues === 0
      ? "\nNothing to repair."
      : APPLY
        ? "\nDone."
        : "\nRe-run with --fix to apply."
  );
  await pool.end();
};

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
