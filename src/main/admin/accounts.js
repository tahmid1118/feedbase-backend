const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const {
  getAccount,
  setAccountPlan,
  resetAccountToFree,
  cancelActiveSubscription,
} = require("../../common/accountBilling");

const PLANS = ["free", "pro", "business"];

/**
 * List billing ACCOUNTS (subscriptions are per account, not per workspace). An
 * account is an email that OWNS ≥1 active workspace; its plan is `billing_accounts`
 * (free if none), and it covers every workspace it owns.
 */
const listAccounts = async (search, lg) => {
  try {
    const like = `%${(search || "").trim()}%`;
    const hasSearch = (search || "").trim().length > 0;
    const [rows] = await pool.query(
      `SELECT u.email,
              MAX(u.full_name) AS name,
              COUNT(DISTINCT t.id) AS owned_count,
              GROUP_CONCAT(DISTINCT t.subdomain ORDER BY t.subdomain SEPARATOR ', ') AS workspaces,
              COALESCE(ba.plan_name, 'free') AS plan_name,
              ba.subscription_status,
              ba.billing_interval,
              ba.current_period_end,
              MAX(u.is_platform_admin) AS is_platform_admin
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id AND t.is_active = 1
         LEFT JOIN billing_accounts ba ON ba.email = u.email
        WHERE u.role = 'owner' AND u.is_active = 1
          ${hasSearch ? "AND (u.email LIKE ? OR u.full_name LIKE ?)" : ""}
        GROUP BY u.email, ba.plan_name, ba.subscription_status, ba.billing_interval, ba.current_period_end
        ORDER BY owned_count DESC, u.email ASC`,
      hasSearch ? [like, like] : []
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { rows })
    );
  } catch (error) {
    console.error("admin listAccounts error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/**
 * Admin plan grant/revoke at the ACCOUNT level. Comps a paid plan (no Stripe) or
 * reverts to free, mirroring onto every workspace the account owns. `durationMonths`
 * falsy/0 = lifetime, a positive integer = expires after that many months. Any live
 * Stripe subscription on the account is cancelled first (so the override replaces
 * it and the customer stops being charged).
 */
const setAccountPlanAdmin = async (email, plan, durationMonths, lg) => {
  if (!email) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg));
  }
  if (!PLANS.includes(plan)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg));
  }
  const months = Number(durationMonths);
  const timed = Number.isInteger(months) && months > 0;
  try {
    // Cancel any live subscription on the active provider first (Stripe/Paddle).
    await cancelActiveSubscription(email);

    if (plan === "free") {
      await resetAccountToFree(email, null);
    } else {
      let periodEnd = null;
      if (timed) {
        periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + months);
      }
      await setAccountPlan(email, {
        plan_name: plan,
        subscription_status: "comped",
        billing_interval: null,
        stripe_subscription_id: null,
        paddle_subscription_id: null,
        current_period_end: periodEnd,
        pending_plan: null,
        pending_interval: null,
        pending_effective_at: null,
      });
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "plan_updated", lg));
  } catch (error) {
    console.error("admin setAccountPlan error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { listAccounts, setAccountPlanAdmin };
