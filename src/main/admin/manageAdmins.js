const bcrypt = require("bcrypt");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Platform admins are now `users` accounts carrying `is_platform_admin = 1`
 * (keyed by email — an account may span several workspace rows). "Managing
 * admins" therefore GRANTS or REVOKES the role; it never deletes the underlying
 * user account (that would destroy their workspaces).
 */

/** List admin accounts — one representative row per email. */
const listAdmins = async (lg) => {
  try {
    const [rows] = await pool.query(
      `SELECT MIN(id) AS id, email, MAX(full_name) AS full_name,
              MAX(is_active) AS is_active, MAX(last_login_at) AS last_login_at,
              MIN(created_at) AS created_at
         FROM users
        WHERE is_platform_admin = 1
        GROUP BY email
        ORDER BY created_at DESC`
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

/** Grant the platform-admin role to an account (create a pending one if new). */
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
  try {
    const [rows] = await pool.query(
      "SELECT id, is_platform_admin FROM users WHERE email = ?",
      [email]
    );
    if (rows.length > 0) {
      // Existing account — grant the role. (Password untouched: it's their own.)
      if (rows.some((r) => r.is_platform_admin === 1)) {
        return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "admin_email_taken", lg));
      }
      await pool.query("UPDATE users SET is_platform_admin = 1 WHERE email = ?", [email]);
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "admin_created", lg, { granted: true })
      );
    }
    // New person — create a pending admin user (needs a password to log in).
    if (password.length < 8) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "password_too_short", lg));
    }
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role, is_active, is_platform_admin)
       VALUES (NULL, ?, ?, ?, 'user', 1, 1)`,
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

/** Resolve the email an admin-list id belongs to. */
const emailForId = async (id) => {
  const [rows] = await pool.query("SELECT email FROM users WHERE id = ? LIMIT 1", [id]);
  return rows[0]?.email || null;
};

/** Grant/revoke the role for an account (revoking = removing admin powers). */
const setAdminActive = async (id, isActive, actingAdminEmail, lg) => {
  try {
    const email = await emailForId(id);
    if (!email) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "admin_not_found", lg));
    }
    if (email === actingAdminEmail && !isActive) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "cannot_modify_self", lg));
    }
    await pool.query("UPDATE users SET is_platform_admin = ? WHERE email = ?", [isActive ? 1 : 0, email]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "admin_updated", lg));
  } catch (error) {
    console.error("setAdminActive error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Revoke the platform-admin role (the user account itself is kept). */
const deleteAdmin = async (id, actingAdminEmail, lg) => {
  try {
    const email = await emailForId(id);
    if (!email) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "admin_not_found", lg));
    }
    if (email === actingAdminEmail) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "cannot_modify_self", lg));
    }
    await pool.query("UPDATE users SET is_platform_admin = 0 WHERE email = ?", [email]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "admin_deleted", lg));
  } catch (error) {
    console.error("deleteAdmin error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { listAdmins, createAdmin, setAdminActive, deleteAdmin };
