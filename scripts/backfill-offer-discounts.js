/**
 * Create the provider discount for active offers that don't have one yet, and
 * store its id on the offer row.
 *
 * Why this is needed: an offer is a DB row (what we display) plus a provider
 * discount (what makes checkout bill that price). Rows created before the
 * discount code existed — or created against a different Paddle environment,
 * since sandbox and live discounts are separate universes — have no discount, so
 * checkout charges list price while the pricing card advertises the offer.
 * `getActiveOffers` now hides such offers rather than mis-advertising them; this
 * script is how you make them real instead.
 *
 * Idempotent: offers that already have a discount for the active provider are
 * skipped. Safe to re-run, and required after switching PADDLE_ENV.
 *
 *   node scripts/backfill-offer-discounts.js          # apply
 *   node scripts/backfill-offer-discounts.js --dry    # show what would happen
 *   node scripts/backfill-offer-discounts.js --force  # re-create even if an id
 *                                                     # is already stored
 *
 * AFTER SWITCHING PADDLE_ENV (sandbox -> production) YOU MUST USE --force. The
 * rows still hold the *sandbox* discount ids, which don't exist in the live
 * account, so a plain run would skip every offer and checkout would quietly bill
 * list price. (`getActiveOffers` hides those offers rather than mis-advertising
 * them, so the failure is safe — but the offer is silently gone until you run
 * this.) The same applies to promo codes: re-create those in the Admin Panel.
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");
const { listPrice } = require("../src/consts/plans");
const { isPaddleActive } = require("../src/common/billingProvider");
const { createPaddleOfferDiscount } = require("../src/common/discounts");

const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");

(async () => {
  if (!isPaddleActive()) {
    console.log("BILLING_PROVIDER is not paddle — nothing to do (Stripe coupons are created inline).");
    await pool.end();
    return;
  }

  const [rows] = await pool.query(
    `SELECT id, plan, billing_interval, offer_price, label, paddle_discount_id
       FROM offers
      WHERE is_active = 1
        AND (ends_at IS NULL OR ends_at >= NOW())`
  );

  if (rows.length === 0) {
    console.log("no active offers found.");
    await pool.end();
    return;
  }

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const tag = `offer ${r.id} ${r.plan}/${r.billing_interval} $${Number(r.offer_price).toFixed(2)}`;
    if (r.paddle_discount_id && !FORCE) {
      console.log(`SKIP  ${tag} — already has ${r.paddle_discount_id} (use --force to re-create, e.g. after switching PADDLE_ENV)`);
      skipped += 1;
      continue;
    }
    const interval = r.billing_interval === "year" ? "year" : "month";
    const originalPrice = listPrice(r.plan, interval);
    const offerPrice = Number(r.offer_price);
    if (!(offerPrice > 0) || offerPrice >= originalPrice) {
      console.error(`ERROR ${tag} — offer price is not below the $${originalPrice} list price; fix the row first.`);
      continue;
    }
    if (DRY) {
      console.log(`WOULD ${tag} — create a flat $${(originalPrice - offerPrice).toFixed(2)} off discount`);
      continue;
    }
    try {
      const id = await createPaddleOfferDiscount({ plan: r.plan, interval, originalPrice, offerPrice });
      await pool.query("UPDATE offers SET paddle_discount_id = ? WHERE id = ?", [id, r.id]);
      console.log(`OK    ${tag} — created ${id} (flat $${(originalPrice - offerPrice).toFixed(2)} off)`);
      created += 1;
    } catch (e) {
      console.error(`FAIL  ${tag} — ${e.message}`);
    }
  }
  console.log(`\n${DRY ? "(dry run) " : ""}created=${created} skipped=${skipped} total=${rows.length}`);
  await pool.end();
})().catch((e) => {
  console.error("backfill error:", e.message);
  process.exit(1);
});
