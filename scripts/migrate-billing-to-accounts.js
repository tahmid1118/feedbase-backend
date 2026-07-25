/**
 * Migrate per-workspace subscriptions → per-ACCOUNT (email). Subscriptions used
 * to live on `tenants`; they now live on `billing_accounts` (one per email) and
 * are mirrored onto every workspace the account owns. Idempotent — safe to re-run.
 *
 *   node scripts/migrate-billing-to-accounts.js
 *
 * For each distinct owner email of active workspaces, pick the best current plan
 * among the owned workspaces (an active real Stripe subscription wins; else the
 * best comp; else free), write the billing_accounts row, and mirror it onto all
 * owned workspaces. If an account somehow has MULTIPLE live paid subs, keep the
 * highest and cancel the rest in Stripe (no refund).
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");
const { stripe, isStripeConfigured } = require("../src/common/stripe");
const { PLAN_RANK } = require("../src/consts/plans");
const { setAccountPlan } = require("../src/common/accountBilling");

const rank = (p) => PLAN_RANK[p] ?? 0;

(async () => {
  // Every owner + the current billing state of the workspaces they own.
  const [rows] = await pool.query(
    `SELECT u.email,
            t.id AS tenant_id, t.plan_name, t.subscription_status, t.billing_interval,
            t.current_period_end, t.stripe_customer_id, t.stripe_subscription_id
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id AND t.is_active = 1
      WHERE u.role = 'owner' AND u.is_active = 1`
  );

  const byEmail = new Map();
  for (const r of rows) {
    if (!byEmail.has(r.email)) byEmail.set(r.email, []);
    byEmail.get(r.email).push(r);
  }

  // Idempotency: once an account has been migrated, billing_accounts is the
  // source of truth (and the tenant source columns have been cleared). Re-running
  // must NOT recompute from the now-empty tenants — that would wipe an account's
  // Stripe linkage. So skip any account that already has a billing_accounts row.
  const [existing] = await pool.query("SELECT email FROM billing_accounts");
  const migrated = new Set(existing.map((r) => r.email));

  for (const [email, owned] of byEmail) {
    if (migrated.has(email)) {
      console.log(`${email}: already migrated — skipping`);
      continue;
    }
    // Candidate real subscriptions (highest tier first, then most recent period).
    const subs = owned
      .filter((o) => o.stripe_subscription_id && o.subscription_status !== "comped")
      .sort(
        (a, b) =>
          rank(b.plan_name) - rank(a.plan_name) ||
          new Date(b.current_period_end || 0) - new Date(a.current_period_end || 0)
      );
    // Candidate comps (highest tier first; a lifetime comp — null expiry — wins).
    const comps = owned
      .filter((o) => o.subscription_status === "comped")
      .sort(
        (a, b) =>
          rank(b.plan_name) - rank(a.plan_name) ||
          (a.current_period_end === null ? -1 : b.current_period_end === null ? 1 : 0)
      );

    let fields;
    if (subs.length > 0) {
      const best = subs[0];
      // Cancel any OTHER live paid subs so the account isn't double-charged.
      for (const extra of subs.slice(1)) {
        if (isStripeConfigured() && extra.stripe_subscription_id) {
          try {
            await stripe.subscriptions.cancel(extra.stripe_subscription_id);
            console.log(`  cancelled duplicate sub ${extra.stripe_subscription_id} (tenant ${extra.tenant_id})`);
          } catch (e) {
            console.error(`  cancel duplicate sub failed (non-fatal): ${e.message}`);
          }
        }
      }
      fields = {
        plan_name: best.plan_name || "free",
        subscription_status: best.subscription_status || "active",
        billing_interval: best.billing_interval || null,
        stripe_customer_id: best.stripe_customer_id || null,
        stripe_subscription_id: best.stripe_subscription_id || null,
        current_period_end: best.current_period_end || null,
      };
    } else if (comps.length > 0) {
      const best = comps[0];
      fields = {
        plan_name: best.plan_name || "free",
        subscription_status: "comped",
        billing_interval: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        current_period_end: best.current_period_end || null,
      };
    } else {
      fields = {
        plan_name: "free",
        subscription_status: null,
        billing_interval: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        current_period_end: null,
      };
    }

    // Upsert billing_accounts + mirror onto all owned workspaces (clears their
    // legacy tenant-level Stripe ids).
    await setAccountPlan(email, fields);
    console.log(
      `${email}: ${fields.plan_name}` +
        `${fields.subscription_status ? ` (${fields.subscription_status})` : ""}` +
        ` — mirrored to ${owned.length} workspace(s)`
    );
  }

  await pool.end();
  console.log("\nDone.");
})().catch((e) => {
  console.error("migration error:", e.message);
  process.exit(1);
});
