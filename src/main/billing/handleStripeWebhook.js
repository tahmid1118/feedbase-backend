const { pool } = require("../../../database/dbPool");
const { stripe } = require("../../common/stripe");
const { planByPriceId } = require("../../consts/plans");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

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

/** Reset a tenant to the free tier when its subscription is deleted. */
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
 * @description Verify and process a Stripe webhook. Throws (statusCode 400) on a
 * bad signature so the route can reply with an error; otherwise resolves once
 * the relevant tenant has been updated.
 * @param {Buffer} rawBody the unparsed request body
 * @param {string} signature the `stripe-signature` header
 */
const handleStripeWebhook = async (rawBody, signature) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (err) {
    const e = new Error(err.message || "Invalid signature");
    e.statusCode = 400;
    throw e;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          if (!sub.metadata?.tenantId && session.metadata?.tenantId) {
            sub.metadata = { ...sub.metadata, tenantId: session.metadata.tenantId };
          }
          await applySubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await applySubscription(event.data.object);
        break;
      case "customer.subscription.deleted":
        await resetToFree(event.data.object);
        break;
      default:
        break;
    }
  } catch (err) {
    // Log but still acknowledge — a 500 would make Stripe retry indefinitely.
    console.error(`Webhook handler error for ${event.type}:`, err);
  }

  return { received: true };
};

module.exports = { handleStripeWebhook };
