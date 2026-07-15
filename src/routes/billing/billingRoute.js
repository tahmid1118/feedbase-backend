const express = require("express");
const billingRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { getBillingStatus } = require("../../main/billing/getBillingStatus");
const { createCheckoutSession } = require("../../main/billing/createCheckoutSession");
const { createPortalSession } = require("../../main/billing/createPortalSession");
const { redeemPromo } = require("../../main/billing/redeemPromo");

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
