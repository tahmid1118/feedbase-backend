const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { stripe, isStripeConfigured } = require("../../common/stripe");

const PLANS = ["free", "pro", "business"];

/**
 * Cancel a tenant's live Stripe subscription (if any) so an admin plan grant /
 * revoke doesn't leave a real subscription running alongside the override —
 * otherwise the tenant keeps being charged for their OLD plan and "Manage
 * billing" opens the Stripe portal on that stale subscription. Best-effort.
 */
const cancelStripeSubscription = async (subscriptionId) => {
  if (!subscriptionId || !isStripeConfigured()) return;
  try {
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (error) {
    // Already canceled / not found is fine — we're clearing it locally anyway.
    console.error("cancelStripeSubscription (non-fatal):", error.message);
  }
};

/** List every workspace with its owner + basic counts (admin view). */
const listWorkspaces = async (search, lg) => {
  try {
    const like = `%${(search || "").trim()}%`;
    const hasSearch = (search || "").trim().length > 0;
    const [rows] = await pool.query(
      `SELECT t.id, t.name, t.subdomain, t.custom_domain, t.plan_name,
              t.subscription_status, t.is_active, t.created_at,
              (SELECT email FROM users WHERE tenant_id = t.id AND role='owner' LIMIT 1) AS owner_email,
              (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) AS user_count,
              (SELECT COUNT(*) FROM posts WHERE tenant_id = t.id) AS post_count
       FROM tenants t
       ${hasSearch ? "WHERE t.name LIKE ? OR t.subdomain LIKE ? OR t.custom_domain LIKE ?" : ""}
       ORDER BY t.created_at DESC`,
      hasSearch ? [like, like, like] : []
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { rows })
    );
  } catch (error) {
    console.error("admin listWorkspaces error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** One workspace's detail + its members. */
const getWorkspace = async (id, lg) => {
  try {
    const [rows] = await pool.query("SELECT * FROM tenants WHERE id = ?", [id]);
    if (rows.length === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "tenant_not_found", lg));
    }
    const [members] = await pool.query(
      "SELECT id, email, full_name, role, is_active, created_at FROM users WHERE tenant_id = ? ORDER BY role, created_at",
      [id]
    );
    const tenant = { ...rows[0] };
    delete tenant.stripe_customer_id;
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { tenant, members })
    );
  } catch (error) {
    console.error("admin getWorkspace error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Update editable workspace fields (name / active flag). */
const updateWorkspace = async (id, data, lg) => {
  const sets = [];
  const values = [];
  if (data?.name !== undefined) {
    sets.push("name = ?");
    values.push(String(data.name).trim());
  }
  if (data?.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(data.isActive ? 1 : 0);
  }
  if (sets.length === 0) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "nothing_to_update", lg));
  }
  try {
    values.push(id);
    const [result] = await pool.query(
      `UPDATE tenants SET ${sets.join(", ")} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "tenant_not_found", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "workspace_updated", lg));
  } catch (error) {
    console.error("admin updateWorkspace error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/**
 * Grant/comp a paid plan or revoke it to free (admin override, no Stripe).
 * `durationMonths` sets how long a comp lasts: falsy/0 = LIFETIME (never
 * expires), a positive integer = expires after that many months (reconcile then
 * reverts the workspace to free). Ignored for `plan === "free"`.
 */
const setWorkspacePlan = async (id, plan, durationMonths, lg) => {
  if (!PLANS.includes(plan)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg));
  }
  const months = Number(durationMonths);
  const timed = Number.isInteger(months) && months > 0;
  try {
    // Cancel any live Stripe subscription first — an admin override replaces it,
    // so the tenant must not keep paying for (and "Manage billing" must not show)
    // the old plan.
    const [[current]] = await pool.query(
      "SELECT stripe_subscription_id FROM tenants WHERE id = ?",
      [id]
    );
    if (!current) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "tenant_not_found", lg));
    }
    await cancelStripeSubscription(current.stripe_subscription_id);

    if (plan === "free") {
      await pool.query(
        "UPDATE tenants SET plan_name='free', subscription_status=NULL, billing_interval=NULL, stripe_subscription_id=NULL, current_period_end=NULL WHERE id = ?",
        [id]
      );
    } else {
      // Comp: a paid plan with NO Stripe subscription (any prior one is now
      // canceled + cleared). `current_period_end` is the comp's expiry — NULL for
      // a lifetime comp, or NOW()+N months for a time-limited one (reconcile
      // reverts it to free once past). The reconcile guard preserves live comps.
      await pool.query(
        `UPDATE tenants
            SET plan_name = ?, subscription_status='comped', billing_interval=NULL,
                stripe_subscription_id=NULL,
                current_period_end = ${timed ? "DATE_ADD(NOW(), INTERVAL ? MONTH)" : "NULL"}
          WHERE id = ?`,
        timed ? [plan, months, id] : [plan, id]
      );
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "plan_updated", lg));
  } catch (error) {
    console.error("admin setWorkspacePlan error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Permanently delete a workspace (cascades to its users/posts/etc.). */
const deleteWorkspace = async (id, lg) => {
  try {
    const [result] = await pool.query("DELETE FROM tenants WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "tenant_not_found", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "workspace_deleted", lg));
  } catch (error) {
    console.error("admin deleteWorkspace error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = {
  listWorkspaces,
  getWorkspace,
  updateWorkspace,
  setWorkspacePlan,
  deleteWorkspace,
};
