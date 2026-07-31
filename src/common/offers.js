const { pool } = require("../../database/dbPool");
const { listPrice } = require("../consts/plans");
const { isPaddleActive } = require("./billingProvider");

/**
 * Can this offer actually be CHARGED on the active provider?
 *
 * An offer is two separate things: a row we render a price from, and a provider
 * discount that makes checkout bill that price. Creating the discount is
 * best-effort (a provider outage must not lose the offer), and discounts do not
 * exist across environments — a sandbox discount is meaningless once live. So the
 * two can drift, and when they do we would advertise a price we cannot honour:
 * the card says $5.60/mo and Paddle charges $10. That is a chargeback and a
 * consumer-protection problem, not a cosmetic bug.
 *
 * The invariant is therefore: NEVER SHOW AN OFFER WE CANNOT CHARGE. An offer with
 * no usable discount is simply hidden, so the customer sees the list price and is
 * billed the list price — consistent, if less generous.
 */
const isHonourable = (row) =>
  isPaddleActive() ? Boolean(row.paddle_discount_id) : Boolean(row.stripe_coupon_id);

/**
 * How many BILLING PERIODS a customer keeps the offer price for.
 *
 * The offer's window (starts_at → ends_at) is both how long the offer is on sale
 * AND how long a buyer keeps it:
 *  - MONTHLY: a 3-month offer gives 3 monthly periods at the offer price, then the
 *    customer rolls onto the regular price. Whenever they buy inside the window,
 *    they get the full 3 months.
 *  - YEARLY: one billing period IS a year, so a yearly buyer gets the offer price
 *    for that whole year and renews at the regular price after it — always 1.
 *
 * `null` means "recurs forever", used only for an open-ended offer with no end
 * date. Returned to the client as well, so the card can say "for 3 months, then
 * $10/mo" instead of implying the price is permanent.
 */
const offerDurationPeriods = (interval, startsAt, endsAt) => {
  if (interval === "year") return 1;
  if (!endsAt) return null; // open-ended monthly offer → keep it forever
  const s = startsAt ? new Date(startsAt) : new Date();
  const e = new Date(endsAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() < s.getDate()) months -= 1; // don't count a partial final month
  return Math.max(1, months);
};

// An offer counts as active when the flag is on and "now" is within its window
// (a null bound means open-ended on that side).
const ACTIVE_WHERE =
  "is_active = 1 AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW())";

const shape = (row) => {
  const interval = row.billing_interval === "year" ? "year" : "month";
  // Baseline is the list price for THIS interval (monthly price, or yearly total).
  const originalPrice = listPrice(row.plan, interval);
  const offerPrice = Number(row.offer_price);
  const percentOff =
    originalPrice > 0 ? Math.round((1 - offerPrice / originalPrice) * 100) : 0;
  return {
    id: row.id,
    plan: row.plan,
    interval,
    originalPrice,
    offerPrice,
    percentOff,
    label: row.label || null,
    // How many billing periods the offer price lasts (null = forever).
    durationPeriods: offerDurationPeriods(interval, row.starts_at, row.ends_at),
    endsAt: row.ends_at || null,
    stripeCouponId: row.stripe_coupon_id || null,
    paddleDiscountId: row.paddle_discount_id || null,
  };
};

/**
 * Active offers as `{ [plan]: { month?, year? } }` (most recent wins per
 * plan+interval), for display — the Stripe coupon id is stripped since this is
 * exposed publicly.
 */
const getActiveOffers = async () => {
  const [rows] = await pool.query(
    `SELECT * FROM offers WHERE ${ACTIVE_WHERE} ORDER BY created_at DESC`
  );
  const byPlan = {};
  for (const r of rows) {
    // Only advertise what checkout can actually apply (see isHonourable).
    if (!isHonourable(r)) {
      console.warn(
        `offer ${r.id} (${r.plan}/${r.billing_interval}) has no discount on the active provider — hiding it so we don't advertise a price we can't charge. Re-create it in the Admin Panel.`
      );
      continue;
    }
    const o = shape(r);
    byPlan[o.plan] = byPlan[o.plan] || {};
    if (byPlan[o.plan][o.interval]) continue; // keep the most recent
    const { stripeCouponId, paddleDiscountId, ...pub } = o;
    void stripeCouponId;
    void paddleDiscountId;
    byPlan[o.plan][o.interval] = pub;
  }
  return byPlan;
};

/** The active offer for one plan + interval, or null (includes the coupon id). */
const getActiveOfferForPlanInterval = async (plan, interval) => {
  const iv = interval === "year" ? "year" : "month";
  const [rows] = await pool.query(
    `SELECT * FROM offers WHERE plan = ? AND billing_interval = ? AND ${ACTIVE_WHERE} ORDER BY created_at DESC LIMIT 1`,
    [plan, iv]
  );
  return rows[0] ? shape(rows[0]) : null;
};

module.exports = { getActiveOffers, getActiveOfferForPlanInterval, offerDurationPeriods };
