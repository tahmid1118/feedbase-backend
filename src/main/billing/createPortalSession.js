const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { stripe, isStripeConfigured } = require("../../common/stripe");

const BILLING_ROLES = ["owner"];
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

/**
 * @description Create a Stripe Billing Portal session so the account owner can
 * manage (update card / cancel) their ACCOUNT subscription.
 * @param {object} authData { email, role, lg }
 */
const createPortalSession = async (authData) => {
  const { email, role, lg } = authData;

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

  try {
    const [rows] = await pool.query(
      "SELECT stripe_customer_id FROM billing_accounts WHERE email = ?",
      [email]
    );
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "no_active_subscription", lg)
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${FRONTEND_URL}/dashboard/settings?tab=billing`,
    });

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "portal_session_created", lg, {
        url: session.url,
      })
    );
  } catch (error) {
    console.error("Error creating portal session:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_create_portal",
        lg
      )
    );
  }
};

module.exports = { createPortalSession };
