const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * Admin side of support chat. The platform admin sees every session across all
 * workspaces, replies, and closes a session when done. Closing hides it from the
 * user but the admin keeps the full transcript (sessions are never deleted here).
 */

const MAX_BODY = 4000;

/** Queue of sessions (default open first). `status` filters open|closed. */
const listSessions = async (status, lg) => {
  // Only surface sessions that actually have a message — a user who opens the
  // widget but never sends creates no conversation worth showing/closing.
  const conds = ["EXISTS (SELECT 1 FROM support_messages m WHERE m.session_id = s.id)"];
  if (status === "open") conds.push("s.status = 'open'");
  else if (status === "closed") conds.push("s.status = 'closed'");
  const where = `WHERE ${conds.join(" AND ")}`;
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.tenant_id, s.user_id, s.user_email, s.user_name, s.status,
              s.created_at, s.last_message_at, s.closed_at,
              t.name AS workspace_name,
              (SELECT COUNT(*) FROM support_messages m
                 WHERE m.session_id = s.id AND m.sender = 'user'
                   AND (s.admin_last_read_at IS NULL OR m.created_at > s.admin_last_read_at)
              ) AS unread_from_user,
              (SELECT body FROM support_messages m2
                 WHERE m2.session_id = s.id ORDER BY m2.id DESC LIMIT 1) AS last_message
         FROM support_sessions s
         LEFT JOIN tenants t ON t.id = s.tenant_id
         ${where}
        ORDER BY (s.status = 'open') DESC, s.last_message_at IS NULL, s.last_message_at DESC, s.id DESC`,
      []
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { rows })
    );
  } catch (error) {
    console.error("admin listSessions error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** One session (any status) + full transcript; marks user messages as read. */
const getSession = async (id, lg) => {
  try {
    const [[session]] = await pool.query(
      `SELECT s.id, s.tenant_id, s.user_id, s.user_email, s.user_name, s.status,
              s.created_at, s.last_message_at, s.closed_at,
              t.name AS workspace_name
         FROM support_sessions s
         LEFT JOIN tenants t ON t.id = s.tenant_id
        WHERE s.id = ?`,
      [id]
    );
    if (!session) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "support_session_not_found", lg));
    }
    const [messages] = await pool.query(
      "SELECT id, sender, body, created_at FROM support_messages WHERE session_id = ? ORDER BY id ASC",
      [id]
    );
    await pool.query(
      "UPDATE support_sessions SET admin_last_read_at = NOW() WHERE id = ?",
      [id]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { session, messages })
    );
  } catch (error) {
    console.error("admin getSession error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Admin reply into an OPEN session (can't post to a closed one). */
const sendMessage = async (id, body, adminId, lg) => {
  const text = (body || "").toString().trim();
  if (!text) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "message_body_required", lg));
  }
  try {
    const [[session]] = await pool.query(
      "SELECT id, status FROM support_sessions WHERE id = ?",
      [id]
    );
    if (!session) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "support_session_not_found", lg));
    }
    if (session.status !== "open") {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "support_session_closed", lg));
    }
    await pool.query(
      "INSERT INTO support_messages (session_id, sender, sender_admin_id, body) VALUES (?, 'admin', ?, ?)",
      [id, adminId, text.slice(0, MAX_BODY)]
    );
    await pool.query(
      "UPDATE support_sessions SET last_message_at = NOW(), admin_last_read_at = NOW() WHERE id = ?",
      [id]
    );
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, "support_message_sent", lg));
  } catch (error) {
    console.error("admin sendMessage error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Close a session — the user can no longer see it; the transcript is kept. */
const closeSession = async (id, adminId, lg) => {
  try {
    const [result] = await pool.query(
      "UPDATE support_sessions SET status = 'closed', closed_at = NOW(), closed_by_admin_id = ? WHERE id = ? AND status = 'open'",
      [adminId, id]
    );
    if (result.affectedRows === 0) {
      // Either it doesn't exist or it's already closed.
      const [[exists]] = await pool.query("SELECT id FROM support_sessions WHERE id = ?", [id]);
      if (!exists) {
        return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "support_session_not_found", lg));
      }
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "support_session_closed_success", lg));
  } catch (error) {
    console.error("admin closeSession error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Count of open sessions with unread user messages (admin sidebar badge). */
const getInboxUnread = async (lg) => {
  try {
    const [[{ sessions_with_unread }]] = await pool.query(
      `SELECT COUNT(*) AS sessions_with_unread FROM support_sessions s
        WHERE s.status = 'open'
          AND EXISTS (
            SELECT 1 FROM support_messages m
             WHERE m.session_id = s.id AND m.sender = 'user'
               AND (s.admin_last_read_at IS NULL OR m.created_at > s.admin_last_read_at)
          )`
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, {
        sessionsWithUnread: sessions_with_unread,
      })
    );
  } catch (error) {
    console.error("admin getInboxUnread error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { listSessions, getSession, sendMessage, closeSession, getInboxUnread };
