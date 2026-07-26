const express = require("express");
const billingRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { getBillingStatus } = require("../../main/billing/getBillingStatus");
const { createCheckoutSession } = require("../../main/billing/createCheckoutSession");
const { createPortalSession } = require("../../main/billing/createPortalSession");
const { redeemPromo } = require("../../main/billing/redeemPromo");
const {
  previewPlanChange,
  applyPlanChange,
  cancelScheduledChange,
} = require("../../main/billing/changePlan");
const {
  cancelSubscription,
  resumeSubscription,
} = require("../../main/billing/cancelSubscription");

/**
 * @description Current subscription status for the authenticated tenant.
 */
billingRouter.post("/status", authenticateToken, languageValidator, async (req, res) => {
  getBillingStatus({ ...req.auth, lg: req.body.lg })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Start a Stripe Checkout session for a paid plan.
 * Body: { plan: "pro" | "business", interval?: "month" | "year", promotionCode? }
 */
billingRouter.post("/checkout", authenticateToken, languageValidator, async (req, res) => {
  const { plan, lg, promotionCode, interval } = req.body;
  createCheckoutSession(plan, { ...req.auth, lg }, promotionCode, interval)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Redeem a promo code (owner only). Free-plan codes comp the plan
 * instantly; percent-off codes return a Stripe promotion code for checkout.
 * Body: { code }
 */
billingRouter.post("/redeem", authenticateToken, languageValidator, async (req, res) => {
  redeemPromo(req.body?.code, { ...req.auth, lg: req.body.lg })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Preview an in-app plan change (exact prorated charge for upgrades)
 * WITHOUT applying it. Body: { plan, interval?, lg }
 */
billingRouter.post("/change/preview", authenticateToken, languageValidator, async (req, res) => {
  previewPlanChange(req.body?.plan, req.body?.interval, { ...req.auth, lg: req.body.lg })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Apply an in-app plan change. Upgrade = prorated charge now;
 * downgrade = scheduled at period end. Body: { plan, interval?, lg }
 */
billingRouter.post("/change", authenticateToken, languageValidator, async (req, res) => {
  applyPlanChange(req.body?.plan, req.body?.interval, { ...req.auth, lg: req.body.lg })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Cancel a scheduled (pending) downgrade — keep the current plan.
 */
billingRouter.post("/change/cancel", authenticateToken, languageValidator, async (req, res) => {
  cancelScheduledChange({ ...req.auth, lg: req.body.lg })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Cancel the subscription at period end (keep access until then, no
 * further charge). Reverts to Free when the period ends.
 */
billingRouter.post("/cancel", authenticateToken, languageValidator, async (req, res) => {
  cancelSubscription({ ...req.auth, lg: req.body.lg })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Resume a subscription that was set to cancel at period end.
 */
billingRouter.post("/resume", authenticateToken, languageValidator, async (req, res) => {
  resumeSubscription({ ...req.auth, lg: req.body.lg })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Open the Stripe Billing Portal to manage the subscription.
 */
billingRouter.post("/portal", authenticateToken, languageValidator, async (req, res) => {
  createPortalSession({ ...req.auth, lg: req.body.lg })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

module.exports = { billingRouter };
