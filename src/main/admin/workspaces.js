const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

const PLANS = ["free", "pro", "business"];

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

/** Grant/comp a paid plan or revoke it to free (admin override, no Stripe). */
const setWorkspacePlan = async (id, plan, lg) => {
  if (!PLANS.includes(plan)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg));
  }
  try {
    if (plan === "free") {
      await pool.query(
        "UPDATE tenants SET plan_name='free', subscription_status=NULL, stripe_subscription_id=NULL, current_period_end=NULL WHERE id = ?",
        [id]
      );
    } else {
      // Comp: a paid plan with no Stripe subscription. 'comped' status is
      // preserved by the reconcile guard so it isn't reset to free on load.
      await pool.query(
        "UPDATE tenants SET plan_name = ?, subscription_status='comped', current_period_end=NULL WHERE id = ?",
        [plan, id]
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
