const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * Platform administrators live in a SEPARATE `admins` table (independent of
 * `users`), so the same email can be both an admin and a normal customer. Admin
 * tokens carry `scope:'admin'` so `authenticateAdmin` can tell them apart from
 * ordinary user tokens.
 */
const generateAdminToken = (admin) =>
  jwt.sign(
    { adminId: admin.id, email: admin.email, scope: "admin" },
    process.env.SECRET_ACCESS_TOKEN,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRE }
  );

const adminLogin = async (userData, lg) => {
  const language = userData?.lg || lg || "en";
  const email = (userData?.email || "").toLowerCase().trim();
  const password = userData?.password || "";

  if (!email || !password) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email_or_password", language)
    );
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, email, full_name, password_hash, avatar_url FROM admins WHERE email = ? AND is_active = 1 LIMIT 1",
      [email]
    );
    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email_or_password", language)
      );
    }

    const admin = rows[0];
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email_or_password", language)
      );
    }

    await pool.query("UPDATE admins SET last_login_at = NOW() WHERE id = ?", [admin.id]);

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "user_logged_in_successfully", language, {
        token: generateAdminToken(admin),
        id: admin.id,
        email: admin.email,
        fullName: admin.full_name,
        imageUrl: admin.avatar_url,
      })
    );
  } catch (error) {
    console.error("Admin login error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email_or_password", language)
    );
  }
};

module.exports = { adminLogin };
