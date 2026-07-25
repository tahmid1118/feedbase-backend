/**
 * Shared Stripe SDK client. Reads the secret key from the environment; if it's
 * missing the client is still constructed (calls will fail clearly at runtime),
 * so the server can boot without Stripe configured during development.
 *
 * The SAME code runs against test (`sk_test_…`) or live (`sk_live_…`) keys —
 * "going live" is purely an env change (live key + live price IDs + live webhook
 * secret). The mode is derived from the key; the guardrail below warns loudly on
 * a dangerous mismatch so sandbox keys never ship to production, and a live key
 * never charges real cards from a dev box.
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

/** 'live' | 'test' | 'unconfigured', from the secret key prefix. */
const stripeMode = () => {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "unconfigured";
};

// Boot-time mode check (logs once per worker). Only when a key is actually set.
if (isStripeConfigured()) {
  const mode = stripeMode();
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && mode === "test") {
    console.warn(
      "⚠  Stripe is in TEST mode but NODE_ENV=production — NO real payments will be taken. Set a live key (STRIPE_SECRET_KEY=sk_live_…) + live price IDs + a live webhook secret."
    );
  } else if (!isProd && mode === "live") {
    console.warn(
      "⚠  Stripe is in LIVE mode but NODE_ENV is not production — REAL cards will be charged. Use test keys outside production."
    );
  } else {
    console.log(`Stripe configured in ${mode.toUpperCase()} mode.`);
  }
}

module.exports = { stripe, isStripeConfigured, stripeMode };
