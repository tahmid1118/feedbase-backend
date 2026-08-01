/**
 * Clear Paddle customer/subscription ids that don't exist in the CURRENT Paddle
 * environment, and reset those accounts to Free.
 *
 * WHY: sandbox and production are separate universes for *everything* — not just
 * prices and discounts, but customers and subscriptions too. After switching
 * PADDLE_ENV, any account that subscribed during sandbox testing still points at
 * a `sub_…` the live account has never heard of. The symptoms are ugly:
 *   - the app shows a PAID plan while nothing is actually billing
 *   - every plan change fails with "Subscription … not found"
 *   - reconcile can't repair it, because the id it looks up doesn't exist
 *
 * This verifies each stored id against the live API and clears only the ones that
 * are genuinely gone. Accounts with a working subscription are left untouched, as
 * are COMPED accounts (their plan is granted by us, not by Paddle).
 *
 *   node scripts/clear-stale-paddle-refs.js --dry   # report only
 *   node scripts/clear-stale-paddle-refs.js         # apply
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");
const { paddle, isPaddleConfigured, paddleMode } = require("../src/common/paddle");
const { setAccountPlan } = require("../src/common/accountBilling");

const DRY = process.argv.includes("--dry");

/** true when the id is absent from the current environment (not a transient error). */
const isGone = async (kind, id) => {
  try {
    if (kind === "sub") await paddle.subscriptions.get(id);
    else await paddle.customers.get(id);
    return false;
  } catch (e) {
    if (/not found/i.test(e.message || "")) return true;
    console.error(`  ! could not verify ${kind} ${id}: ${e.message} — leaving it alone`);
    return false; // never delete data on an ambiguous error
  }
};

(async () => {
  if (!isPaddleConfigured()) {
    console.log("Paddle not configured — nothing to do.");
    await pool.end();
    return;
  }
  console.log(`checking stored Paddle ids against the ${paddleMode().toUpperCase()} account\n`);

  const [rows] = await pool.query(
    `SELECT email, plan_name, subscription_status, paddle_customer_id, paddle_subscription_id
       FROM billing_accounts
      WHERE paddle_customer_id IS NOT NULL OR paddle_subscription_id IS NOT NULL`
  );

  let cleared = 0;
  for (const r of rows) {
    if (r.subscription_status === "comped") {
      console.log(`SKIP  ${r.email} — comped (plan granted by us, not Paddle)`);
      continue;
    }
    const subGone = r.paddle_subscription_id ? await isGone("sub", r.paddle_subscription_id) : true;
    const custGone = r.paddle_customer_id ? await isGone("cust", r.paddle_customer_id) : true;

    if (!subGone) {
      console.log(`OK    ${r.email} — subscription exists in this environment`);
      continue;
    }
    if (DRY) {
      console.log(`WOULD ${r.email} — reset ${r.plan_name}/${r.subscription_status} → free (stale ids)`);
      continue;
    }
    await setAccountPlan(r.email, {
      plan_name: "free",
      subscription_status: null,
      billing_interval: null,
      current_period_end: null,
      paddle_subscription_id: null,
      // Keep a customer id that still resolves — it saves re-creating the customer.
      ...(custGone ? { paddle_customer_id: null } : {}),
      pending_plan: null,
      pending_interval: null,
      pending_effective_at: null,
    });
    console.log(`RESET ${r.email} — was ${r.plan_name}/${r.subscription_status}, stale ids cleared`);
    cleared += 1;
  }
  console.log(`\n${DRY ? "(dry run) " : ""}reset=${cleared} checked=${rows.length}`);
  await pool.end();
})().catch((e) => {
  console.error("error:", e.message);
  process.exit(1);
});
