const express = require("express");
const paddleWebhookRouter = express.Router();
const { handleWebhook } = require("../../main/billing/paddleBilling");

/**
 * @description Paddle webhook receiver. Mounted in app.js with
 * `express.raw({ type: "application/json" })` BEFORE the global JSON parser so the
 * raw body survives for signature verification (Paddle-Signature: ts=..;h1=..).
 * POST /webhooks/paddle
 */
paddleWebhookRouter.post("/", async (req, res) => {
  const signature = req.headers["paddle-signature"];
  try {
    // paddle.webhooks.unmarshal needs the raw body as a string.
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
    const result = await handleWebhook(raw, signature);
    return res.json(result);
  } catch (err) {
    console.error("Paddle webhook error:", err.message);
    return res.status(err.statusCode || 400).send(`Webhook Error: ${err.message}`);
  }
});

module.exports = { paddleWebhookRouter };
