/**
 * Read-only billing health check. Answers, in one command:
 *
 *   1. Does every provider id we've stored still EXIST in the current Paddle
 *      environment? (offers, promo codes, customers, subscriptions)
 *   2. Does every active offer still CHARGE the price we advertise?
 *   3. Does every offer's discount expire when the offer does?
 *
 * Why this exists: the expensive billing bugs in this project were never loud.
 * The app kept rendering, the scripts kept printing OK, and the damage was a
 * price quoted that wasn't the price charged, or a row pointing at a provider
 * object from a different environment. Both are invisible until a customer pays.
 *
 * Nothing is written and no transactions are created — safe to run against
 * production at any time. Fix what it reports with:
 *   - stale customer/subscription ids → scripts/clear-stale-paddle-refs.js
 *   - stale/missing offer discounts   → scripts/backfill-offer-discounts.js --force
 *   - stale promo discounts           → re-create the code in the Admin Panel
 *
 *   node scripts/audit-billing.js
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");
const { paddle, isPaddleConfigured, paddleMode } = require("../src/common/paddle");
const { listPrice, paddlePriceIdFor } = require("../src/consts/plans");
const { offerDurationPeriods } = require("../src/common/offers");

const m = (c) => `$${(Number(c) / 100).toFixed(2)}`;
let problems = 0;
const fail = (msg) => { problems += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);

/** Resolve a provider object; returns "ok" | "gone" | "error". */
const resolve = async (fn, id) => {
  try { await fn(id); return "ok"; }
  catch (e) { return /not found/i.test(e.message || "") ? "gone" : "error"; }
};

(async () => {
  if (!isPaddleConfigured()) { console.log("Paddle not configured."); await pool.end(); return; }
  console.log(`\nBILLING AUDIT — Paddle ${paddleMode().toUpperCase()}\n${"=".repeat(46)}`);

  // 1. Prices referenced by config exist and match lib/plans.ts.
  console.log("\n[1] catalog prices");
  for (const plan of ["pro", "business"]) for (const iv of ["month", "year"]) {
    const id = paddlePriceIdFor(plan, iv);
    if (!id) { fail(`${plan}/${iv}: no PADDLE_PRICE_* configured`); continue; }
    try {
      const p = await paddle.prices.get(id);
      const want = Math.round(listPrice(plan, iv) * 100);
      Number(p.unitPrice.amount) === want
        ? ok(`${plan}/${iv} ${m(p.unitPrice.amount)}`)
        : fail(`${plan}/${iv} price is ${m(p.unitPrice.amount)} but plans.js says ${m(want)}`);
    } catch (e) { fail(`${plan}/${iv} price ${id} — ${e.message}`); }
  }

  // 2. Active offers: discount exists, charges the advertised price, expires with
  //    the offer, and is restricted to the right price.
  console.log("\n[2] active offers (advertised == charged)");
  const [offers] = await pool.query(
    `SELECT id, plan, billing_interval, offer_price, starts_at, ends_at, paddle_discount_id
       FROM offers WHERE is_active = 1
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at >= NOW())`
  );
  if (!offers.length) console.log("  (none active)");
  for (const o of offers) {
    const iv = o.billing_interval === "year" ? "year" : "month";
    const tag = `offer ${o.id} ${o.plan}/${iv}`;
    if (!o.paddle_discount_id) { fail(`${tag} has NO discount — it will be hidden from the pricing page`); continue; }
    try {
      const d = await paddle.discounts.get(o.paddle_discount_id);
      const priceId = paddlePriceIdFor(o.plan, iv);
      const listC = Math.round(listPrice(o.plan, iv) * 100);
      const wantC = Math.round(Number(o.offer_price) * 100);
      const charge = listC - Number(d.amount);
      charge === wantC ? ok(`${tag} charges ${m(charge)} (advertised ${m(wantC)})`)
                       : fail(`${tag} charges ${m(charge)} but advertises ${m(wantC)}`);
      const wantPeriods = offerDurationPeriods(iv, o.starts_at, o.ends_at);
      String(d.maximumRecurringIntervals) === String(wantPeriods)
        ? ok(`${tag} lasts ${wantPeriods ?? "forever"} period(s)`)
        : fail(`${tag} lasts ${d.maximumRecurringIntervals ?? "FOREVER"} period(s), expected ${wantPeriods ?? "forever"}`);
      (d.restrictTo || []).includes(priceId)
        ? ok(`${tag} restricted to its own price`)
        : fail(`${tag} is NOT restricted to ${priceId} — it could discount another plan`);
      d.status === "active" || fail(`${tag} discount is ${d.status}`);
    } catch (e) {
      fail(`${tag} discount ${o.paddle_discount_id} — ${/not found/i.test(e.message) ? "DOES NOT EXIST in this environment" : e.message}`);
    }
  }

  // 3. Promo codes: the discount behind each active percent-off code must exist.
  console.log("\n[3] active promo codes");
  const [promos] = await pool.query(
    "SELECT id, code, type, paddle_discount_id FROM promo_codes WHERE is_active = 1 AND type = 'percent_off'"
  );
  if (!promos.length) console.log("  (no active percent-off codes)");
  for (const p of promos) {
    if (!p.paddle_discount_id) { fail(`${p.code} has no discount — checkout would charge full price`); continue; }
    const st = await resolve((i) => paddle.discounts.get(i), p.paddle_discount_id);
    st === "ok" ? ok(`${p.code}`) : fail(`${p.code} → discount ${st === "gone" ? "DOES NOT EXIST in this environment" : "could not be read"}`);
  }

  // 4. Stored customer/subscription ids resolve. A stale one shows a PAID plan
  //    with nothing billing, and breaks every plan change.
  console.log("\n[4] stored customer / subscription references");
  const [accts] = await pool.query(
    `SELECT email, plan_name, subscription_status, paddle_customer_id, paddle_subscription_id
       FROM billing_accounts
      WHERE paddle_customer_id IS NOT NULL OR paddle_subscription_id IS NOT NULL`
  );
  if (!accts.length) console.log("  (no accounts hold Paddle ids)");
  for (const a of accts) {
    if (a.subscription_status === "comped") { ok(`${a.email} — comped, skipped`); continue; }
    if (a.paddle_subscription_id) {
      const st = await resolve((i) => paddle.subscriptions.get(i), a.paddle_subscription_id);
      st === "ok" ? ok(`${a.email} subscription`)
        : fail(`${a.email} shows ${a.plan_name}/${a.subscription_status} but its subscription ${st === "gone" ? "DOES NOT EXIST here — nothing is billing them" : "could not be read"}`);
    }
    if (a.paddle_customer_id) {
      const st = await resolve((i) => paddle.customers.get(i), a.paddle_customer_id);
      st === "ok" || fail(`${a.email} customer id ${st === "gone" ? "does not exist in this environment" : "could not be read"}`);
    }
  }

  console.log(`\n${"=".repeat(46)}`);
  console.log(problems === 0 ? "PASS — no billing problems found.\n" : `${problems} PROBLEM(S) FOUND — see FAIL lines above.\n`);
  await pool.end();
  process.exit(problems === 0 ? 0 : 1);
})().catch((e) => { console.error("audit error:", e.message); process.exit(1); });
