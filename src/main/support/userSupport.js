const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * User side of support chat. A user talks to the platform admin in a session.
 * A user has AT MOST ONE open session — "Contact support" resumes it or opens a
 * fresh one. A closed session is invisible to the user (every read here is
 * scoped to `status='open'`), though the admin keeps the transcript.
 */

const MAX_BODY = 4000;

/** The caller's current OPEN session, or null. */
const findOpenSession = async (userId) => {
  const [rows] = await pool.query(
    "SELECT id, status, created_at, last_message_at FROM support_sessions WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
    [userId]
  );
  return rows[0] || null;
};

/** Resume the caller's open session, or create one. */
const openSession = async (authData) => {
  const { id: userId, tenantId, email, lg } = authData;
  try {
    const existing = await findOpenSession(userId);
    if (existing) {
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "support_session_ready", lg, { session: existing })
      );
    }
    // Denormalize the display identity so admin history survives account deletion.
    const [[user]] = await pool.query(
      "SELECT full_name FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    const [result] = await pool.query(
      "INSERT INTO support_sessions (tenant_id, user_id, user_email, user_name) VALUES (?, ?, ?, ?)",
      [tenantId || null, userId, email, user?.full_name || null]
    );
    const [[session]] = await pool.query(
      "SELECT id, status, created_at, last_message_at FROM support_sessions WHERE id = ?",
      [result.insertId]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.CREATED, "support_session_ready", lg, { session })
    );
  } catch (error) {
    console.error("support openSession error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Assert the session is the caller's and still open; returns it or null. */
const ownOpenSession = async (sessionId, userId) => {
  const [rows] = await pool.query(
    "SELECT id FROM support_sessions WHERE id = ? AND user_id = ? AND status = 'open' LIMIT 1",
    [sessionId, userId]
  );
  return rows[0] || null;
};

/** Messages in the caller's OPEN session; marks admin replies as read. */
const getMessages = async (sessionId, authData) => {
  const { id: userId, lg } = authData;
  try {
    const session = await ownOpenSession(sessionId, userId);
    if (!session) {
      // Closed or not theirs — a closed session must be unreachable to the user.
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.FORBIDDEN, "support_session_unavailable", lg)
      );
    }
    const [messages] = await pool.query(
      "SELECT id, sender, body, created_at FROM support_messages WHERE session_id = ? ORDER BY id ASC",
      [sessionId]
    );
    await pool.query(
      "UPDATE support_sessions SET user_last_read_at = NOW() WHERE id = ?",
      [sessionId]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "support_messages_retrieved", lg, { messages })
    );
  } catch (error) {
    if (error?.statusCode) return Promise.reject(error);
    console.error("support getMessages error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Post a user message into the caller's open session. */
const sendMessage = async (sessionId, body, authData) => {
  const { id: userId, lg } = authData;
  const text = (body || "").toString().trim();
  if (!text) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "message_body_required", lg));
  }
  try {
    const session = await ownOpenSession(sessionId, userId);
    if (!session) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.FORBIDDEN, "support_session_unavailable", lg)
      );
    }
    await pool.query(
      "INSERT INTO support_messages (session_id, sender, sender_user_id, body) VALUES (?, 'user', ?, ?)",
      [sessionId, userId, text.slice(0, MAX_BODY)]
    );
    await pool.query(
      "UPDATE support_sessions SET last_message_at = NOW(), user_last_read_at = NOW() WHERE id = ?",
      [sessionId]
    );
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, "support_message_sent", lg));
  } catch (error) {
    console.error("support sendMessage error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Unread admin replies in the caller's open session (drives the badge). */
const getUnread = async (authData) => {
  const { id: userId, lg } = authData;
  try {
    const session = await findOpenSession(userId);
    if (!session) {
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "support_unread_retrieved", lg, {
          hasOpenSession: false,
          sessionId: null,
          unreadCount: 0,
        })
      );
    }
    const [[{ unread }]] = await pool.query(
      `SELECT COUNT(*) AS unread FROM support_messages m
        JOIN support_sessions s ON s.id = m.session_id
       WHERE m.session_id = ? AND m.sender = 'admin'
         AND (s.user_last_read_at IS NULL OR m.created_at > s.user_last_read_at)`,
      [session.id]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "support_unread_retrieved", lg, {
        hasOpenSession: true,
        sessionId: session.id,
        unreadCount: unread,
      })
    );
  } catch (error) {
    console.error("support getUnread error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { openSession, getMessages, sendMessage, getUnread };
