const crypto = require("crypto");
const { pool } = require("../../database/dbPool");
const { getPlanLimits } = require("../consts/plans");
const { getTenantPlan } = require("./planGuard");

/**
 * Device sessions — the mechanism behind "one device at a time".
 *
 * Every issued user JWT carries an `sid` claim pointing at a row in
 * `user_sessions`. `authenticateToken` rejects a token whose session has been
 * revoked, so a session can be killed server-side without waiting for the JWT
 * to expire.
 *
 * Sessions are keyed by **email** (the account identity), not by `users.id`:
 * one person can hold a row in several tenants, and switching workspaces must
 * not read as signing in on a new device.
 *
 * On plans without `multiDevice` (Free, Pro) a second login is BLOCKED while a
 * session is still live. To make sure that can't strand someone who simply
 * closed their browser, a session that hasn't been seen for IDLE_MINUTES is
 * treated as abandoned and may be taken over — the takeover revokes it, so at
 * most one session is ever live for an account on those plans.
 */
const IDLE_MINUTES = 15;

/** Sessions not seen for this long are abandoned and can be taken over. */
const LIVE_WHERE = `revoked_at IS NULL AND last_seen_at > (NOW() - INTERVAL ${IDLE_MINUTES} MINUTE)`;

const clip = (v, n) => (v ? String(v).slice(0, n) : null);

/** The live (non-revoked, recently-seen) session for an account, if any. */
const getLiveSessionForEmail = async (email) => {
  const [rows] = await pool.query(
    `SELECT session_id, user_agent, ip_address, last_seen_at
       FROM user_sessions
      WHERE email = ? AND ${LIVE_WHERE}
      ORDER BY last_seen_at DESC
      LIMIT 1`,
    [email]
  );
  return rows[0] || null;
};

/** Kill every session for an account (used on takeover and "sign out everywhere"). */
const revokeSessionsForEmail = async (email) => {
  const [r] = await pool.query(
    "UPDATE user_sessions SET revoked_at = NOW() WHERE email = ? AND revoked_at IS NULL",
    [email]
  );
  return r.affectedRows;
};

/** Kill one session (normal sign-out). */
const revokeSession = async (sessionId) => {
  if (!sessionId) return 0;
  const [r] = await pool.query(
    "UPDATE user_sessions SET revoked_at = NOW() WHERE session_id = ? AND revoked_at IS NULL",
    [sessionId]
  );
  return r.affectedRows;
};

/** Start a device session and return its id (goes into the JWT as `sid`). */
const createSession = async (email, req) => {
  const sessionId = crypto.randomBytes(24).toString("hex");
  await pool.query(
    `INSERT INTO user_sessions (session_id, email, user_agent, ip_address)
     VALUES (?, ?, ?, ?)`,
    [
      sessionId,
      email,
      clip(req?.header?.("user-agent"), 255),
      clip(req?.ip || req?.socket?.remoteAddress, 64),
    ]
  );
  return sessionId;
};

/** Is this session still usable? (Revoked ⇒ no. Idle-but-unrevoked ⇒ yes.) */
const isSessionActive = async (sessionId) => {
  if (!sessionId) return false;
  const [rows] = await pool.query(
    "SELECT 1 FROM user_sessions WHERE session_id = ? AND revoked_at IS NULL LIMIT 1",
    [sessionId]
  );
  return rows.length > 0;
};

/**
 * Mark a session as alive. Throttled to one write per minute so a busy
 * dashboard doesn't hammer the table on every request.
 */
const touchSession = async (sessionId) => {
  if (!sessionId) return;
  await pool.query(
    `UPDATE user_sessions
        SET last_seen_at = NOW()
      WHERE session_id = ?
        AND revoked_at IS NULL
        AND last_seen_at < (NOW() - INTERVAL 1 MINUTE)`,
    [sessionId]
  );
};

/**
 * May this account hold several sessions at once? Governed by the plan of the
 * workspace being signed in to; an account with no workspace yet (fresh signup)
 * is treated as Free.
 */
const allowsMultiDevice = async (tenantId) => {
  if (!tenantId) return false;
  return Boolean(getPlanLimits(await getTenantPlan(tenantId)).multiDevice);
};

/**
 * The gate applied at every point a *new* session would be created (login,
 * OAuth, invitation accept). Returns the new session id, or rejects with
 * `{ blocked: true, session }` when a single-device plan already has a live one.
 */
const startSession = async (user, req) => {
  const multiDevice = await allowsMultiDevice(user.tenant_id);
  if (!multiDevice) {
    const live = await getLiveSessionForEmail(user.email);
    if (live) return { blocked: true, session: live };
    // Nothing live — but an abandoned session may still be unrevoked. Clear it
    // so exactly one session exists for this account.
    await revokeSessionsForEmail(user.email);
  }
  return { blocked: false, sessionId: await createSession(user.email, req) };
};

module.exports = {
  IDLE_MINUTES,
  startSession,
  createSession,
  getLiveSessionForEmail,
  isSessionActive,
  touchSession,
  revokeSession,
  revokeSessionsForEmail,
  allowsMultiDevice,
};
