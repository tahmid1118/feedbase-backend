const bcrypt = require("bcrypt");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** List platform admins. */
const listAdmins = async (lg) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, email, full_name, is_active, last_login_at, created_at FROM admins ORDER BY created_at DESC"
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { rows })
    );
  } catch (error) {
    console.error("listAdmins error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Create a new platform admin. */
const createAdmin = async (data, lg) => {
  const email = String(data?.email || "").toLowerCase().trim();
  const fullName = String(data?.fullName || "").trim();
  const password = String(data?.password || "");

  if (!EMAIL_RE.test(email)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email", lg));
  }
  if (!fullName) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "nothing_to_update", lg));
  }
  if (password.length < 8) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "password_too_short", lg));
  }
  try {
    const [existing] = await pool.query("SELECT id FROM admins WHERE email = ?", [email]);
    if (existing.length > 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "admin_email_taken", lg));
    }
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO admins (email, password_hash, full_name) VALUES (?, ?, ?)",
      [email, hash, fullName]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.CREATED, "admin_created", lg, { id: result.insertId })
    );
  } catch (error) {
    console.error("createAdmin error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Activate/deactivate an admin (cannot deactivate yourself). */
const setAdminActive = async (id, isActive, actingAdminId, lg) => {
  if (Number(id) === Number(actingAdminId) && !isActive) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "cannot_modify_self", lg));
  }
  try {
    const [result] = await pool.query(
      "UPDATE admins SET is_active = ? WHERE id = ?",
      [isActive ? 1 : 0, id]
    );
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "admin_not_found", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "admin_updated", lg));
  } catch (error) {
    console.error("setAdminActive error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Delete an admin (cannot delete yourself). */
const deleteAdmin = async (id, actingAdminId, lg) => {
  if (Number(id) === Number(actingAdminId)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "cannot_modify_self", lg));
  }
  try {
    const [result] = await pool.query("DELETE FROM admins WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "admin_not_found", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "admin_deleted", lg));
  } catch (error) {
    console.error("deleteAdmin error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { listAdmins, createAdmin, setAdminActive, deleteAdmin };
