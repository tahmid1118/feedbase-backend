const { pool } = require("../../database/dbPool");
const { PLANS } = require("../consts/plans");

// An offer counts as active when the flag is on and "now" is within its window
// (a null bound means open-ended on that side).
const ACTIVE_WHERE =
  "is_active = 1 AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW())";

const shape = (row) => {
  const originalPrice = PLANS[row.plan]?.price ?? 0;
  const offerPrice = Number(row.offer_price);
  const percentOff =
    originalPrice > 0 ? Math.round((1 - offerPrice / originalPrice) * 100) : 0;
  return {
    id: row.id,
    plan: row.plan,
    originalPrice,
    offerPrice,
    percentOff,
    label: row.label || null,
    endsAt: row.ends_at || null,
    stripeCouponId: row.stripe_coupon_id || null,
  };
};

/** Active offers keyed by plan (most recent wins if several). */
const getActiveOffers = async () => {
  const [rows] = await pool.query(
    `SELECT * FROM offers WHERE ${ACTIVE_WHERE} ORDER BY created_at DESC`
  );
  const byPlan = {};
  for (const r of rows) if (!byPlan[r.plan]) byPlan[r.plan] = shape(r);
  return byPlan;
};

/** The active offer for one plan, or null. */
const getActiveOfferForPlan = async (plan) => {
  const [rows] = await pool.query(
    `SELECT * FROM offers WHERE plan = ? AND ${ACTIVE_WHERE} ORDER BY created_at DESC LIMIT 1`,
    [plan]
  );
  return rows[0] ? shape(rows[0]) : null;
};

module.exports = { getActiveOffers, getActiveOfferForPlan };
