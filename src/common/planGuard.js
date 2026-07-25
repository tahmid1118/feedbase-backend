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
 * An account's tier — its plan, straight from `billing_accounts` (the per-account
 * subscription is the source of truth). An account with no billing row (a fresh
 * signup, or a pure member who never subscribed) is 'free'.
 */
const getAccountTier = async (email) => {
  if (!email) return "free";
  const [rows] = await pool.query(
    "SELECT plan_name FROM billing_accounts WHERE email = ?",
    [email]
  );
  return rows[0]?.plan_name || "free";
};

/**
 * How many workspaces an account owns / has joined, its tier, and the per-tier
 * caps — everything needed to gate "create workspace" and "accept invitation",
 * and to show the state in the UI. `ownLimit`/`joinLimit` are `null` when
 * unlimited (Infinity doesn't survive JSON).
 */
const getAccountWorkspaceUsage = async (email) => {
  const [rows] = await pool.query(
    `SELECT u.role
       FROM users u JOIN tenants t ON u.tenant_id = t.id
      WHERE u.email = ? AND u.is_active = 1 AND t.is_active = 1`,
    [email]
  );
  const owned = rows.filter((r) => r.role === "owner");
  const ownedCount = owned.length;
  const memberCount = rows.length - ownedCount;
  // Tier is the account's own subscription plan, not derived from workspaces.
  const tier = await getAccountTier(email);
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
