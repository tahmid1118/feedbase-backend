/**
 * Shared Stripe SDK client. Reads the secret key from the environment; if it's
 * missing the client is still constructed (calls will fail clearly at runtime),
 * so the server can boot without Stripe configured during development.
 */
const Stripe = require("stripe");

// The SDK throws if constructed with an empty key, so when Stripe isn't
// configured yet we pass a harmless placeholder to let the server boot. Real
// calls are gated by isStripeConfigured() in the billing handlers.
const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || "sk_test_not_configured",
  { apiVersion: "2024-06-20" }
);

const isStripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

module.exports = { stripe, isStripeConfigured };
