const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { stripe, isStripeConfigured } = require("../../common/stripe");
const { PLANS, priceIdFor } = require("../../consts/plans");
const { getActiveOfferForPlan } = require("../../common/offers");

const BILLING_ROLES = ["owner"];
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

/**
 * @description Create a Stripe Checkout Session for a paid plan and return its
 * hosted URL. Ensures the tenant has a Stripe Customer first (creating + storing
 * one on the tenant if needed).
 * @param {string} plan plan key ("pro" | "business")
 * @param {object} authData { id, email, tenantId, role, lg }
 * @param {string} [promotionCode] Stripe promotion code id to apply as a discount
 * @param {string} [interval] "month" (default) | "year" — yearly is ~20% cheaper
 */
const createCheckoutSession = async (plan, authData, promotionCode, interval) => {
  const { tenantId, role, email, lg } = authData;
  const billingInterval = interval === "year" ? "year" : "month";

  if (!BILLING_ROLES.includes(role)) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.FORBIDDEN, "billing_forbidden", lg)
    );
  }
  if (!isStripeConfigured()) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "stripe_not_configured", lg)
    );
  }

  const planDef = PLANS[plan];
  const priceId = priceIdFor(plan, billingInterval);
  if (!planDef || plan === "free" || !priceId) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg)
    );
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, name, stripe_customer_id FROM tenants WHERE id = ?",
      [tenantId]
    );
    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "tenant_not_found", lg)
      );
    }
    const tenant = rows[0];

    let customerId = tenant.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: tenant.name,
        email: email || undefined,
        metadata: { tenantId: String(tenantId) },
      });
      customerId = customer.id;
      await pool.query(
        "UPDATE tenants SET stripe_customer_id = ? WHERE id = ?",
        [customerId, tenantId]
      );
    }

    // Discount precedence (all mutually exclusive with Stripe's own code field):
    //   1. a redeemed promo code (explicit promotionCode),
    //   2. an active plan offer (auto-applied coupon) — MONTHLY only, since the
    //      yearly price already bakes in the 20% yearly discount and stacking
    //      would double-discount,
    //   3. otherwise let the customer type a code at Checkout.
    let discountOpts = { allow_promotion_codes: true };
    if (promotionCode) {
      discountOpts = { discounts: [{ promotion_code: promotionCode }] };
    } else if (billingInterval === "month") {
      const offer = await getActiveOfferForPlan(plan);
      if (offer?.stripeCouponId) {
        discountOpts = { discounts: [{ coupon: offer.stripeCouponId }] };
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { tenantId: String(tenantId), plan, interval: billingInterval },
      subscription_data: { metadata: { tenantId: String(tenantId), plan } },
      ...discountOpts,
      success_url: `${FRONTEND_URL}/dashboard/settings?tab=billing&checkout=success`,
      cancel_url: `${FRONTEND_URL}/dashboard/settings?tab=billing&checkout=cancelled`,
    });

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "checkout_session_created", lg, {
        url: session.url,
      })
    );
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_create_checkout",
        lg
      )
    );
  }
};

module.exports = { createCheckoutSession };
