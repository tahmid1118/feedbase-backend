const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { getPlanLimits } = require("../../consts/plans");

/**
 * @description Return the authenticated tenant's current subscription state for
 * the Billing settings tab.
 * @param {object} authData { tenantId, lg }
 */
const getBillingStatus = async (authData) => {
  const { tenantId, lg } = authData;
  try {
    const [rows] = await pool.query(
      `SELECT plan_name, subscription_status, current_period_end,
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
      currentPeriodEnd: t.current_period_end || null,
      hasSubscription: Boolean(t.stripe_subscription_id),
      limits: getPlanLimits(planName),
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
