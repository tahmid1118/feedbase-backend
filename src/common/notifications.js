const { pool } = require("../../database/dbPool");

/** Active team members of a tenant (owner + users), optionally excluding one. */
const getTeamRecipients = async (tenantId, excludeUserId = null) => {
  const [rows] = await pool.query(
    `SELECT id FROM users
      WHERE tenant_id = ? AND is_active = 1${excludeUserId ? " AND id <> ?" : ""}`,
    excludeUserId ? [tenantId, excludeUserId] : [tenantId]
  );
  return rows.map((r) => r.id);
};

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

/**
 * Fan a single in-app notification out to a workspace's team members (one row
 * per recipient), e.g. new feedback or a new comment. Fire-and-forget: callers
 * should NOT await it, and it swallows its own errors so a notification failure
 * never breaks (or rolls back) the action that triggered it.
 *
 * @param {number} tenantId
 * @param {object} n
 * @param {string} n.type          notifications.notification_type enum value
 * @param {string} n.title         English fallback (stored verbatim)
 * @param {string} [n.message]     English fallback (stored verbatim)
 * @param {object} [n.meta]        structured pieces of the text, e.g.
 *   { key: "comment", postTitle, who, body }. The client renders these through
 *   i18n so the notification reads in the RECIPIENT's language — `title` and
 *   `message` are frozen English at write time and cannot be translated later.
 * @param {string} [n.referenceType] e.g. "post" (drives the client deep-link)
 * @param {number} [n.referenceId]
 * @param {number} [n.excludeUserId] don't notify this member (usually the actor)
 */
const notifyTeam = async (
  tenantId,
  {
    type,
    title,
    message = null,
    meta = null,
    referenceType = null,
    referenceId = null,
    excludeUserId = null,
  }
) => {
  try {
    const recipients = await getTeamRecipients(tenantId, excludeUserId);
    if (recipients.length === 0) return;
    const metaJson = meta ? JSON.stringify(meta) : null;
    const values = recipients.map((userId) => [
      tenantId,
      userId,
      type,
      clip(title, 160),
      clip(message, 2000),
      metaJson,
      referenceType,
      referenceId,
    ]);
    await pool.query(
      `INSERT INTO notifications
         (tenant_id, user_id, notification_type, title, message, meta, reference_type, reference_id)
       VALUES ?`,
      [values]
    );
  } catch (error) {
    console.error("notifyTeam failed (non-fatal):", error.message);
  }
};

module.exports = { notifyTeam, getTeamRecipients };
