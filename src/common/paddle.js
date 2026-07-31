/**
 * Shared Paddle SDK client (Merchant of Record — the active payment provider).
 * Mirrors src/common/stripe.js: reads the API key from the environment; if it's
 * missing the client is still constructed with a placeholder (real calls are
 * gated by isPaddleConfigured()) so the server boots unconfigured in dev.
 *
 * "Going live" flips PADDLE_ENV to `production` with production keys/prices/webhook.
 * The guardrail below warns loudly on a dangerous mismatch so sandbox keys never
 * ship to production and a production key never charges real cards from a dev box.
 */
const { Paddle, Environment } = require("@paddle/paddle-node-sdk");

/** 'production' | 'sandbox' — from PADDLE_ENV (defaults to sandbox). */
const paddleMode = () =>
  process.env.PADDLE_ENV === "production" ? "production" : "sandbox";

const isPaddleConfigured = () => Boolean(process.env.PADDLE_API_KEY);

const environment =
  paddleMode() === "production" ? Environment.production : Environment.sandbox;

const paddle = new Paddle(process.env.PADDLE_API_KEY || "pdl_sdbx_not_configured", {
  environment,
});

// Boot-time mode check (logs once per worker), only when a key is actually set.
if (isPaddleConfigured()) {
  const mode = paddleMode();
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && mode === "sandbox") {
    console.warn(
      "⚠  Paddle is in SANDBOX but NODE_ENV=production — NO real payments will be taken. Set PADDLE_ENV=production + production keys + a production webhook secret."
    );
  } else if (!isProd && mode === "production") {
    console.warn(
      "⚠  Paddle is in PRODUCTION but NODE_ENV is not production — REAL cards will be charged. Use sandbox keys outside production."
    );
  } else {
    console.log(`Paddle configured in ${mode.toUpperCase()} mode.`);
  }

  /**
   * Go-live footguns. Sandbox and production are separate universes: keys, price
   * ids, discounts and webhook secrets from one do not exist in the other. Each of
   * these mismatches fails at the worst possible moment — a customer clicking Buy —
   * so surface them at boot instead.
   */
  const key = process.env.PADDLE_API_KEY || "";
  if (mode === "production" && key.startsWith("pdl_sdbx_")) {
    console.warn("⚠  PADDLE_ENV=production but PADDLE_API_KEY is a SANDBOX key (pdl_sdbx_…) — every Paddle call will fail.");
  }
  if (mode === "sandbox" && key.startsWith("pdl_live_")) {
    console.warn("⚠  PADDLE_ENV=sandbox but PADDLE_API_KEY is a LIVE key (pdl_live_…) — every Paddle call will fail.");
  }
  const missingPrices = [
    "PADDLE_PRICE_PRO",
    "PADDLE_PRICE_PRO_YEARLY",
    "PADDLE_PRICE_BUSINESS",
    "PADDLE_PRICE_BUSINESS_YEARLY",
  ].filter((k) => !process.env[k]);
  if (missingPrices.length) {
    console.warn(
      `⚠  Missing Paddle price id(s): ${missingPrices.join(", ")} — checkout for those plans will fail. Run \`node scripts/paddle-setup.js\` in the ${mode.toUpperCase()} dashboard and paste the ids into .env.`
    );
  }
  if (!process.env.PADDLE_WEBHOOK_SECRET) {
    console.warn("⚠  PADDLE_WEBHOOK_SECRET is not set — webhook signatures cannot be verified, so subscription events will be rejected.");
  }
}

module.exports = { paddle, isPaddleConfigured, paddleMode };
