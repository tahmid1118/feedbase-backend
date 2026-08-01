/**
 * Self-service password reset.
 *
 * Security posture:
 *  - No account enumeration: `requestPasswordReset` ALWAYS resolves success,
 *    whether or not the email belongs to an account.
 *  - The emailed token is random (crypto.randomBytes) and only its SHA-256 hash
 *    is stored, so a leaked DB row cannot be used to reset a password.
 *  - Tokens are single-use, expire after 1 hour, and any prior pending token for
 *    the same email is invalidated when a new one is requested.
 *  - A completed reset revokes every device session for the account, so a reset
 *    also logs the account out everywhere.
 */
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { sendEmail, isMailConfigured } = require("../../common/mailer");
const { passwordResetEmail } = require("../../common/emails/passwordResetEmail");
const { revokeSessionsForEmail } = require("../../common/sessions");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TTL_MINUTES = 60;
const SALT_ROUNDS = 10;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const hashToken = (raw) =>
  crypto.createHash("sha256").update(String(raw || "")).digest("hex");

/** e.g. "ta***@gmail.com" — enough to confirm which inbox, not the full address. */
const maskEmail = (email) => {
  const [user, domain] = String(email || "").split("@");
  if (!domain) return "";
  const head = user.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, user.length - 2))}@${domain}`;
};

/**
 * Request a reset link. Always succeeds (no enumeration). Sends mail only when
 * an active account exists for the email.
 */
const requestPasswordReset = async (email, lg, req) => {
  const normalized = String(email || "").trim().toLowerCase();

  // Respond success for anything vaguely email-shaped without touching the DB
  // when it's clearly malformed — still no signal about existence.
  if (!EMAIL_RE.test(normalized)) {
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "reset_email_sent", lg, {
        emailSent: false,
        mailConfigured: isMailConfigured(),
      })
    );
  }

  try {
    // Deliberately NOT filtered on `password_hash IS NOT NULL`. An account
    // created through social sign-in has no password, and this flow is how it
    // SETS one — otherwise "Continue with Google" would be a one-way door, and
    // losing access to the Google account would mean losing the workspace. The
    // link still goes only to the address on the account, so setting a first
    // password is exactly as safe as replacing an existing one.
    const [[account]] = await pool.query(
      "SELECT email FROM users WHERE email = ? AND is_active = 1 LIMIT 1",
      [normalized]
    );

    let emailSent = false;
    if (account) {
      // Invalidate any earlier pending token so only the newest link works.
      await pool.query(
        "UPDATE password_resets SET status = 'used', used_at = NOW() WHERE email = ? AND status = 'pending'",
        [normalized]
      );

      const rawToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
      const ip =
        (req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim() ||
        req?.socket?.remoteAddress ||
        null;

      await pool.query(
        `INSERT INTO password_resets (email, token_hash, expires_at, requested_ip)
         VALUES (?, ?, ?, ?)`,
        [normalized, hashToken(rawToken), expiresAt, ip ? String(ip).slice(0, 64) : null]
      );

      const resetUrl = `${FRONTEND_URL}/reset-password/${rawToken}`;
      const mail = passwordResetEmail({ resetUrl, expiresInMinutes: RESET_TTL_MINUTES });
      const delivery = await sendEmail({ to: normalized, ...mail });
      emailSent = delivery.sent;
    }

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "reset_email_sent", lg, {
        emailSent,
        mailConfigured: isMailConfigured(),
      })
    );
  } catch (error) {
    console.error("requestPasswordReset error:", error);
    // Even on an internal error, don't leak — but signal a 500 so the client can
    // show a generic "try again".
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "something_went_wrong", lg)
    );
  }
};

/** Load a live (pending, unexpired) reset row for a raw token, or null. */
const findLiveReset = async (rawToken) => {
  const [[row]] = await pool.query(
    `SELECT id, email FROM password_resets
     WHERE token_hash = ? AND status = 'pending' AND expires_at > NOW() LIMIT 1`,
    [hashToken(rawToken)]
  );
  return row || null;
};

/** Validate a token for the reset page to render. */
const validateResetToken = async (token, lg) => {
  const row = await findLiveReset(token);
  if (!row) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.NOT_FOUND, "invalid_or_expired_reset_token", lg)
    );
  }
  return Promise.resolve(
    setServerResponse(API_STATUS_CODE.OK, "success", lg, { email: maskEmail(row.email) })
  );
};

/** Consume a token and set the new password on EVERY row for the account email. */
const resetPassword = async (token, newPassword, lg) => {
  const password = String(newPassword || "");
  if (password.length < 8) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "password_too_short", lg)
    );
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Re-check under the transaction and lock the row so two submits of the same
    // link can't both succeed.
    const [[row]] = await conn.query(
      `SELECT id, email FROM password_resets
       WHERE token_hash = ? AND status = 'pending' AND expires_at > NOW() LIMIT 1 FOR UPDATE`,
      [hashToken(token)]
    );
    if (!row) {
      await conn.rollback();
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "invalid_or_expired_reset_token", lg)
      );
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    // An account's workspaces each have their own `users` row sharing one hash —
    // update them all so the new password works in every workspace.
    await conn.query("UPDATE users SET password_hash = ?, updated_at = NOW() WHERE email = ?", [
      hash,
      row.email,
    ]);
    await conn.query(
      "UPDATE password_resets SET status = 'used', used_at = NOW() WHERE id = ?",
      [row.id]
    );

    await conn.commit();

    // A password change should end every existing session — outside the txn,
    // best-effort (a session-revoke failure must not fail the reset).
    revokeSessionsForEmail(row.email).catch((e) =>
      console.error("revokeSessionsForEmail after reset failed:", e.message)
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "password_reset_successful", lg)
    );
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error("resetPassword error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_change_password", lg)
    );
  } finally {
    conn.release();
  }
};

module.exports = { requestPasswordReset, validateResetToken, resetPassword };
