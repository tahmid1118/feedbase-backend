const { pool } = require("../../database/dbPool");
const { getPlanLimits } = require("../consts/plans");

/** Current plan name for a tenant (defaults to 'free' if missing). */
const getTenantPlan = async (tenantId) => {
  const [rows] = await pool.query(
    "SELECT plan_name FROM tenants WHERE id = ?",
    [tenantId]
  );
  return rows[0]?.plan_name || "free";
};

/**
 * Whether a tenant's plan includes a boolean capability (e.g. "customDomain",
 * "integrations"). Numeric limits like "seats" are checked at the call site.
 */
const planAllows = async (tenantId, capability) => {
  const limits = getPlanLimits(await getTenantPlan(tenantId));
  return Boolean(limits[capability]);
};

module.exports = { getTenantPlan, planAllows };
