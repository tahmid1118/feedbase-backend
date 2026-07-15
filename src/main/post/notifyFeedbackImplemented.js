const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { planAllows } = require("../../common/planGuard");
const { sendEmail } = require("../../common/mailer");
const { feedbackImplementedEmail } = require("../../common/emails/feedbackImplementedEmail");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const BILLING_ROLES = ["owner"];

/**
 * Email the submitter of a piece of feedback that it has been implemented.
 * Pro+ capability (`contactSubmitter`), owner-only, and only when the post is in
 * the `completed` stage. Records `implemented_notified_at` so the UI can show it
 * was sent (and can be re-sent deliberately).
 *
 * @param {number} postId
 * @param {object} authData { tenantId, role, lg }
 */
const notifyFeedbackImplemented = async (postId, authData) => {
  const { tenantId, role, lg } = authData;

  if (!BILLING_ROLES.includes(role)) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.FORBIDDEN, "billing_forbidden", lg)
    );
  }
  if (!(await planAllows(tenantId, "contactSubmitter"))) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.PAYMENT_REQUIRED, "plan_limit_contact_submitter", lg)
    );
  }

  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.title, p.status,
              COALESCE(u.full_name, p.submitter_name) AS submitter_name,
              COALESCE(u.email, p.submitter_email) AS submitter_email,
              t.name AS workspace_name, t.subdomain
       FROM posts p
       LEFT JOIN users u ON p.author_id = u.id
       JOIN tenants t ON p.tenant_id = t.id
       WHERE p.id = ? AND p.tenant_id = ?
       LIMIT 1`,
      [postId, tenantId]
    );
    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg)
      );
    }
    const post = rows[0];

    if (post.status !== "completed") {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "feedback_not_completed", lg)
      );
    }
    if (!post.submitter_email) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "no_submitter_email", lg)
      );
    }

    const mail = feedbackImplementedEmail({
      workspaceName: post.workspace_name || "the team",
      title: post.title,
      submitterName: post.submitter_name,
      postUrl: `${FRONTEND_URL}/portal/${post.subdomain}/post/${post.id}`,
    });

    const result = await sendEmail({ to: post.submitter_email, ...mail });

    // Record the send even if the provider only logged it (dev) — the owner
    // asked to notify and we did our part.
    await pool.query(
      "UPDATE posts SET implemented_notified_at = NOW() WHERE id = ? AND tenant_id = ?",
      [postId, tenantId]
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "submitter_notified", lg, {
        emailSent: Boolean(result?.sent),
      })
    );
  } catch (error) {
    console.error("notifyFeedbackImplemented error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_notify_submitter", lg)
    );
  }
};

module.exports = { notifyFeedbackImplemented };
