const { pool } = require("../../../database/dbPool");
const { sendEmail } = require("../../common/mailer");
const { newFeedbackEmail } = require("../../common/emails/newFeedbackEmail");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

/**
 * Email the workspace owner when new feedback lands on their public board.
 *
 * Fire-and-forget: this is called WITHOUT await from createPublicPost so a slow
 * SMTP round-trip never delays the visitor's submission, and it swallows its own
 * errors — a mail problem must never fail (or roll back) the post itself.
 */
const notifyOwnerOfNewPost = async (tenantId, postId, post, authUser) => {
  try {
    const [[tenant]] = await pool.query(
      "SELECT name FROM tenants WHERE id = ? LIMIT 1",
      [tenantId]
    );
    const [[owner]] = await pool.query(
      "SELECT id, email FROM users WHERE tenant_id = ? AND role = 'owner' AND is_active = 1 LIMIT 1",
      [tenantId]
    );
    if (!owner || !owner.email) return;

    // Don't email the owner about their own submission.
    if (authUser && Number(authUser.id) === Number(owner.id)) return;

    const authorName =
      authUser?.fullName || post?.submitterName || "Anonymous";

    const mail = newFeedbackEmail({
      workspaceName: tenant?.name || "your workspace",
      title: post?.title || "(untitled)",
      description: post?.description || "",
      postType: post?.postType,
      authorName,
      postUrl: `${FRONTEND_URL}/dashboard/feedback/${postId}`,
    });

    await sendEmail({ to: owner.email, ...mail });
  } catch (error) {
    console.error("notifyOwnerOfNewPost failed (non-fatal):", error.message);
  }
};

module.exports = { notifyOwnerOfNewPost };
