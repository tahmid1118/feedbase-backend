const express = require("express");
const billingRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { getBillingProvider } = require("../../common/billingProvider");

const { getBillingStatus } = require("../../main/billing/getBillingStatus");
const { redeemPromo } = require("../../main/billing/redeemPromo");

// Stripe (dormant) handlers — untouched; selected when BILLING_PROVIDER=stripe.
const { createCheckoutSession } = require("../../main/billing/createCheckoutSession");
const { createPortalSession } = require("../../main/billing/createPortalSession");
const { previewPlanChange, applyPlanChange, cancelScheduledChange } = require("../../main/billing/changePlan");
const { cancelSubscription, resumeSubscription } = require("../../main/billing/cancelSubscription");
// Paddle (active) handlers.
const paddle = require("../../main/billing/paddleBilling");

// Normalized operations per provider (same signatures + setServerResponse shapes).
const stripeOps = {
  checkout: (plan, authData, promo, interval) => createCheckoutSession(plan, authData, promo, interval),
  previewChange: (plan, interval, authData) => previewPlanChange(plan, interval, authData),
  applyChange: (plan, interval, authData) => applyPlanChange(plan, interval, authData),
  cancelScheduledChange,
  cancelSubscription,
  resumeSubscription,
  portal: createPortalSession,
};
const paddleOps = {
  checkout: (plan, authData, promo, interval) => paddle.createCheckout(plan, authData, promo, interval),
  previewChange: (plan, interval, authData) => paddle.previewChange(plan, interval, authData),
  applyChange: (plan, interval, authData) => paddle.applyChange(plan, interval, authData),
  cancelScheduledChange: paddle.cancelScheduledChange,
  cancelSubscription: paddle.cancelSubscription,
  resumeSubscription: paddle.resumeSubscription,
  portal: paddle.createPortalSession,
};
const ops = () => (getBillingProvider() === "stripe" ? stripeOps : paddleOps);

// Shared response shaping for a setServerResponse-returning promise.
const reply = (promise, res) =>
  promise
    .then((d) => res.status(d.statusCode).send({ status: d.status, message: d.message, data: d.result }))
    .catch((e) => res.status(e.statusCode || 500).send({ status: e.status || "error", message: e.message }));

const auth = (req) => ({ ...req.auth, lg: req.body.lg });

// Current subscription state (reconciles from the active provider first).
billingRouter.post("/status", authenticateToken, languageValidator, (req, res) =>
  reply(getBillingStatus(auth(req)), res)
);

// Start checkout. Stripe → { url } (redirect); Paddle → { transactionId } (overlay).
billingRouter.post("/checkout", authenticateToken, languageValidator, (req, res) =>
  reply(ops().checkout(req.body?.plan, auth(req), req.body?.promotionCode, req.body?.interval), res)
);

// Redeem a promo code (owner only). Provider-agnostic comp / percent-off.
billingRouter.post("/redeem", authenticateToken, languageValidator, (req, res) =>
  reply(redeemPromo(req.body?.code, auth(req)), res)
);

// Preview an in-app plan change (prorated charge for upgrades).
billingRouter.post("/change/preview", authenticateToken, languageValidator, (req, res) =>
  reply(ops().previewChange(req.body?.plan, req.body?.interval, auth(req)), res)
);

// Apply an in-app plan change.
billingRouter.post("/change", authenticateToken, languageValidator, (req, res) =>
  reply(ops().applyChange(req.body?.plan, req.body?.interval, auth(req)), res)
);

// Cancel a scheduled (pending) downgrade — keep the current plan.
billingRouter.post("/change/cancel", authenticateToken, languageValidator, (req, res) =>
  reply(ops().cancelScheduledChange(auth(req)), res)
);

// Cancel the subscription at period end (keep access until then, no further charge).
billingRouter.post("/cancel", authenticateToken, languageValidator, (req, res) =>
  reply(ops().cancelSubscription(auth(req)), res)
);

// Resume a subscription set to cancel at period end.
billingRouter.post("/resume", authenticateToken, languageValidator, (req, res) =>
  reply(ops().resumeSubscription(auth(req)), res)
);

// Open the provider's customer portal to manage the subscription.
billingRouter.post("/portal", authenticateToken, languageValidator, (req, res) =>
  reply(ops().portal(auth(req)), res)
);

module.exports = { billingRouter };
