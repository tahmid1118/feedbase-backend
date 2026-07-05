const bcrypt = require("bcrypt");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

const TENANT_ROLES = ["owner", "user"];

/** List all users across every workspace (admin view). */
const listAllUsers = async (search, lg) => {
  try {
    const like = `%${(search || "").trim()}%`;
    const hasSearch = (search || "").trim().length > 0;
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.tenant_id,
              u.created_at, u.last_login_at, t.name AS workspace_name
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       ${hasSearch ? "WHERE u.email LIKE ? OR u.full_name LIKE ?" : ""}
       ORDER BY u.created_at DESC
       LIMIT 500`,
      hasSearch ? [like, like] : []
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { rows })
    );
  } catch (error) {
    console.error("admin listAllUsers error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Update a user's name / role / active flag (any workspace). */
const updateUser = async (id, data, lg) => {
  const sets = [];
  const values = [];
  if (data?.fullName !== undefined) {
    sets.push("full_name = ?");
    values.push(String(data.fullName).trim());
  }
  if (data?.role !== undefined) {
    if (!TENANT_ROLES.includes(data.role)) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_role", lg));
    }
    sets.push("role = ?");
    values.push(data.role);
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
      `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "user_not_found", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "user_updated", lg));
  } catch (error) {
    console.error("admin updateUser error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Reset a user's password to a supplied value. */
const resetUserPassword = async (id, newPassword, lg) => {
  const pwd = String(newPassword || "");
  if (pwd.length < 8) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "password_too_short", lg));
  }
  try {
    const hash = await bcrypt.hash(pwd, 10);
    const [result] = await pool.query(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      [hash, id]
    );
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "user_not_found", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "password_reset", lg));
  } catch (error) {
    console.error("admin resetUserPassword error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Permanently delete a user. */
const deleteUser = async (id, lg) => {
  try {
    const [result] = await pool.query("DELETE FROM users WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "user_not_found", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "user_deleted", lg));
  } catch (error) {
    console.error("admin deleteUser error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { listAllUsers, updateUser, resetUserPassword, deleteUser };
