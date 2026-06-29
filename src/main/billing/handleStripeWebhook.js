const { stripe } = require("../../common/stripe");
const { applySubscription, resetToFree } = require("./applySubscription");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

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
