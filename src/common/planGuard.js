const { pool } = require("../../database/dbPool");
const { getPlanLimits, maxPlan } = require("../consts/plans");

/** Current plan name for a tenant (defaults to 'free' if missing). */
const getTenantPlan = async (tenantId) => {
  const [rows] = await pool.query(
    "SELECT plan_name FROM tenants WHERE id = ?",
    [tenantId]
  );
  return rows[0]?.plan_name || "free";
};

/**
 * An account's effective tier — the highest plan among the workspaces it OWNS
 * (identity is the email). Plans are per-workspace, so this is the only coherent
 * per-account tier: to unlock more workspaces an account upgrades one it owns.
 * An account that owns nothing (a fresh signup, or a pure member) is 'free'.
 */
const getAccountTier = async (email) => {
  const [rows] = await pool.query(
    `SELECT t.plan_name
       FROM users u JOIN tenants t ON u.tenant_id = t.id
      WHERE u.email = ? AND u.role = 'owner' AND u.is_active = 1 AND t.is_active = 1`,
    [email]
  );
  return maxPlan(rows.map((r) => r.plan_name));
};

/**
 * How many workspaces an account owns / has joined, its tier, and the per-tier
 * caps — everything needed to gate "create workspace" and "accept invitation",
 * and to show the state in the UI. `ownLimit`/`joinLimit` are `null` when
 * unlimited (Infinity doesn't survive JSON).
 */
const getAccountWorkspaceUsage = async (email) => {
  const [rows] = await pool.query(
    `SELECT u.role, t.plan_name
       FROM users u JOIN tenants t ON u.tenant_id = t.id
      WHERE u.email = ? AND u.is_active = 1 AND t.is_active = 1`,
    [email]
  );
  const owned = rows.filter((r) => r.role === "owner");
  const ownedCount = owned.length;
  const memberCount = rows.length - ownedCount;
  const tier = maxPlan(owned.map((r) => r.plan_name));
  const limits = getPlanLimits(tier);
  const ownLimit = limits.ownWorkspaces;
  const joinLimit = limits.joinWorkspaces;
  return {
    tier,
    ownedCount,
    memberCount,
    ownLimit: Number.isFinite(ownLimit) ? ownLimit : null,
    joinLimit: Number.isFinite(joinLimit) ? joinLimit : null,
    canCreate: !Number.isFinite(ownLimit) || ownedCount < ownLimit,
    canJoin: !Number.isFinite(joinLimit) || memberCount < joinLimit,
  };
};

/**
 * Whether a tenant's plan includes a boolean capability (e.g. "customDomain",
 * "integrations"). Numeric limits like "seats" are checked at the call site.
 */
const planAllows = async (tenantId, capability) => {
  const limits = getPlanLimits(await getTenantPlan(tenantId));
  return Boolean(limits[capability]);
};

module.exports = {
  getTenantPlan,
  planAllows,
  getAccountTier,
  getAccountWorkspaceUsage,
};
