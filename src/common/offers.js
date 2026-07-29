const { pool } = require("../../database/dbPool");
const { listPrice } = require("../consts/plans");

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

module.exports = { getActiveOffers, getActiveOfferForPlanInterval };
