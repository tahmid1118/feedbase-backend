const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * Platform-admin login. "Platform admin" is now a ROLE on a `users` account
 * (`users.is_platform_admin`), not a separate `admins` table — one account can
 * act as a normal user (via /login) OR as an admin (via this door). The token
 * still carries `scope:'admin'` so the rest of the app (authenticateAdmin, the
 * frontend admin session) is unchanged.
 *
 * An account's `users` rows share one `password_hash`, so any active flagged row
 * verifies the credential.
 */
const generateAdminToken = (account) =>
  jwt.sign(
    { adminId: account.id, adminUserId: account.id, email: account.email, scope: "admin" },
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
      `SELECT id, email, full_name, password_hash, avatar_url
         FROM users
        WHERE email = ? AND is_platform_admin = 1 AND is_active = 1
        ORDER BY id LIMIT 1`,
      [email]
    );
    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email_or_password", language)
      );
    }

    const account = rows[0];
    const ok = await bcrypt.compare(password, account.password_hash);
    if (!ok) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email_or_password", language)
      );
    }

    // Stamp last login across the account's rows (keyed by email like sessions).
    await pool.query("UPDATE users SET last_login_at = NOW() WHERE email = ?", [email]);

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "user_logged_in_successfully", language, {
        token: generateAdminToken(account),
        id: account.id,
        email: account.email,
        fullName: account.full_name,
        imageUrl: account.avatar_url,
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
