const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { getPlanLimits } = require("../../consts/plans");
const { reconcileTenantSubscription } = require("./applySubscription");
const { getActiveOffers } = require("../../common/offers");

/**
 * @description Return the authenticated tenant's current subscription state for
 * the Billing settings tab.
 * @param {object} authData { tenantId, lg }
 */
const getBillingStatus = async (authData) => {
  const { tenantId, lg } = authData;
  try {
    // Reconcile from Stripe first so the plan reflects a just-completed checkout
    // or cancellation even when webhooks aren't delivered (e.g. local dev). A
    // Stripe failure here is non-fatal — we fall back to the stored values.
    try {
      await reconcileTenantSubscription(tenantId);
    } catch (reconcileErr) {
      console.error("Billing reconcile failed (non-fatal):", reconcileErr.message);
    }

    const [rows] = await pool.query(
      `SELECT plan_name, subscription_status, billing_interval, current_period_end,
              stripe_subscription_id
       FROM tenants WHERE id = ?`,
      [tenantId]
    );
    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "tenant_not_found", lg)
      );
    }

    const t = rows[0];
    const planName = t.plan_name || "free";
    const result = {
      planName,
      subscriptionStatus: t.subscription_status || null,
      billingInterval: t.billing_interval || null, // 'month' | 'year' | null
      currentPeriodEnd: t.current_period_end || null,
      hasSubscription: Boolean(t.stripe_subscription_id),
      limits: getPlanLimits(planName),
      // Active promotional offers keyed by plan (for the diagonal-strike price).
      offers: await getActiveOffers(),
    };

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "billing_status_retrieved", lg, result)
    );
  } catch (error) {
    console.error("Error getting billing status:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_get_billing_status",
        lg
      )
    );
  }
};

module.exports = { getBillingStatus };
