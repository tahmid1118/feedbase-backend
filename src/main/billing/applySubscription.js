const { pool } = require("../../../database/dbPool");
const { stripe, isStripeConfigured } = require("../../common/stripe");
const { planByPriceId } = require("../../consts/plans");

const customerIdOf = (sub) =>
  typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;

/** Apply a Stripe Subscription's state onto the matching tenant row. */
const applySubscription = async (sub) => {
  const tenantId = sub.metadata?.tenantId || null;
  const customerId = customerIdOf(sub);
  const priceId = sub.items?.data?.[0]?.price?.id || null;
  const status = sub.status; // active | trialing | past_due | canceled | ...
  const isActive = ["active", "trialing", "past_due"].includes(status);
  const planName = isActive ? planByPriceId(priceId) || "free" : "free";
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;

  const sets =
    "plan_name = ?, subscription_status = ?, stripe_subscription_id = ?, current_period_end = ?";
  const vals = [planName, status, sub.id, periodEnd];

  if (tenantId) {
    await pool.query(`UPDATE tenants SET ${sets} WHERE id = ?`, [...vals, tenantId]);
  } else if (customerId) {
    await pool.query(`UPDATE tenants SET ${sets} WHERE stripe_customer_id = ?`, [
      ...vals,
      customerId,
    ]);
  }
};

/** Reset a tenant to the free tier when its subscription is gone/cancelled. */
const resetToFree = async (sub) => {
  const tenantId = sub.metadata?.tenantId || null;
  const customerId = customerIdOf(sub);
  const sets =
    "plan_name = 'free', subscription_status = ?, stripe_subscription_id = NULL, current_period_end = NULL";
  const vals = [sub.status || "canceled"];

  if (tenantId) {
    await pool.query(`UPDATE tenants SET ${sets} WHERE id = ?`, [...vals, tenantId]);
  } else if (customerId) {
    await pool.query(`UPDATE tenants SET ${sets} WHERE stripe_customer_id = ?`, [
      ...vals,
      customerId,
    ]);
  }
};

/**
 * Pull a tenant's latest subscription straight from Stripe and persist it. This
 * reconciles state after Checkout/Portal when webhooks aren't delivered (e.g.
 * local dev without the Stripe CLI). No-op if Stripe isn't configured or the
 * tenant has no Stripe customer yet.
 */
const reconcileTenantSubscription = async (tenantId) => {
  if (!isStripeConfigured()) return;
  const [rows] = await pool.query(
    "SELECT stripe_customer_id FROM tenants WHERE id = ?",
    [tenantId]
  );
  const customerId = rows[0]?.stripe_customer_id;
  if (!customerId) return;

  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });
  const ranked = [...subs.data].sort((a, b) => b.created - a.created);
  const chosen =
    ranked.find((s) => ["active", "trialing", "past_due"].includes(s.status)) ||
    ranked[0];

  if (!chosen) {
    await pool.query(
      "UPDATE tenants SET plan_name='free', subscription_status=NULL, stripe_subscription_id=NULL, current_period_end=NULL WHERE id=?",
      [tenantId]
    );
    return;
  }
  if (!chosen.metadata?.tenantId) {
    chosen.metadata = { ...chosen.metadata, tenantId: String(tenantId) };
  }
  if (["canceled", "incomplete_expired"].includes(chosen.status)) {
    await resetToFree(chosen);
  } else {
    await applySubscription(chosen);
  }
};

module.exports = { applySubscription, resetToFree, reconcileTenantSubscription };
