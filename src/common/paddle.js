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
}

module.exports = { paddle, isPaddleConfigured, paddleMode };
