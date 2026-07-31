/**
 * Paddle-side discount helpers for promotional OFFERS and percent-off PROMO CODES
 * (Phase 2). Both are applied at checkout by **discount id** on the server-created
 * transaction (`transactions.create({ discountId })`) — the customer never types a
 * code into Paddle's overlay, so the discount is created WITHOUT a `code` and with
 * `enabledForCheckout:false`. This sidesteps Paddle's stricter code charset and
 * keeps our own `promo_codes.code` (validated + redeemed in-app) the single source.
 *
 * Mapping to Paddle's model:
 *  - OFFER  → a `flat` discount (list − offer, in cents), `recur:true` (applies to
 *    every renewal, like the Stripe forever coupon), restricted to that plan+
 *    interval's price so it can only ever discount the intended price.
 *  - PROMO  → a `percentage` discount; `recur` follows the code's duration; when
 *    scoped to a plan it's restricted to that plan's monthly+yearly prices.
 *
 * All calls are guarded by isPaddleConfigured(); callers treat failures as non-fatal
 * (mirroring the Stripe coupon path) so an offer/promo still records in the DB.
 */
const { paddle, isPaddleConfigured } = require("./paddle");
const { paddlePriceIdFor } = require("../consts/plans");

/** Create the Paddle flat discount backing an offer. Returns the discount id. */
const createPaddleOfferDiscount = async ({ plan, interval, originalPrice, offerPrice, durationPeriods }) => {
  if (!isPaddleConfigured()) return null;
  const amountOff = Math.round((originalPrice - offerPrice) * 100); // lowest denomination
  const priceId = paddlePriceIdFor(plan, interval);
  const d = await paddle.discounts.create({
    description: `Offer ${plan} ${interval} $${offerPrice.toFixed(2)}`.slice(0, 500),
    type: "flat",
    amount: String(amountOff),
    currencyCode: "USD",
    recur: true,
    // How many billing periods the buyer keeps this price for. A 3-month monthly
    // offer stops after 3 charges; a yearly offer covers its one yearly period.
    // Omitted (null) = forever, for an open-ended offer.
    ...(durationPeriods ? { maximumRecurringIntervals: durationPeriods } : {}),
    enabledForCheckout: false, // auto-applied by id only
    ...(priceId ? { restrictTo: [priceId] } : {}),
  });
  return d.id;
};

/** Create the Paddle percentage discount backing a percent-off promo code. */
const createPaddlePromoDiscount = async ({
  code,
  percentOff,
  duration,
  durationMonths,
  maxRedemptions,
  expiresAt,
  appliesToPlan,
}) => {
  if (!isPaddleConfigured()) throw new Error("paddle_not_configured");
  const recur = duration !== "once";
  const restrict =
    appliesToPlan && appliesToPlan !== "any"
      ? [paddlePriceIdFor(appliesToPlan, "month"), paddlePriceIdFor(appliesToPlan, "year")].filter(Boolean)
      : null;
  const d = await paddle.discounts.create({
    description: `Promo ${code} ${percentOff}% (${appliesToPlan || "any"})`.slice(0, 500),
    type: "percentage",
    amount: String(percentOff),
    recur,
    ...(recur && duration === "repeating" && durationMonths
      ? { maximumRecurringIntervals: durationMonths }
      : {}),
    ...(maxRedemptions ? { usageLimit: maxRedemptions } : {}),
    ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    enabledForCheckout: false, // redeemed in-app; applied by id at checkout
    ...(restrict ? { restrictTo: restrict } : {}),
  });
  return d.id;
};

/** Archive a Paddle discount (best-effort — used on offer deactivate / promo revoke). */
const archivePaddleDiscount = async (id) => {
  if (!id || !isPaddleConfigured()) return;
  try {
    await paddle.discounts.archive(id);
  } catch (e) {
    // Older SDKs expose archival via update(status) — fall back before giving up.
    try {
      await paddle.discounts.update(id, { status: "archived" });
    } catch (e2) {
      console.error("paddle discount archive failed (non-fatal):", e2.message || e.message);
    }
  }
};

module.exports = {
  createPaddleOfferDiscount,
  createPaddlePromoDiscount,
  archivePaddleDiscount,
};
