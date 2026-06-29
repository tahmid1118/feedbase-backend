const express = require("express");
const stripeWebhookRouter = express.Router();
const { handleStripeWebhook } = require("../../main/billing/handleStripeWebhook");

/**
 * @description Stripe webhook receiver. Mounted in app.js with
 * `express.raw({ type: "application/json" })` BEFORE the global JSON parser so
 * the raw body survives for signature verification.
 * POST /webhooks/stripe
 */
stripeWebhookRouter.post("/", async (req, res) => {
  const signature = req.headers["stripe-signature"];
  try {
    const result = await handleStripeWebhook(req.body, signature);
    return res.json(result);
  } catch (err) {
    console.error("Stripe webhook error:", err.message);
    return res.status(err.statusCode || 400).send(`Webhook Error: ${err.message}`);
  }
});

module.exports = { stripeWebhookRouter };
