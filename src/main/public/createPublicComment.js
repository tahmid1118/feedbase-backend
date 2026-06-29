const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @description Add a comment to a post from the PUBLIC portal (no auth). The
 * author is a guest: `author_id` is NULL and the optional name/email are stored
 * on the comment. Supports threaded replies via `parentCommentId`.
 * @param {number} tenantId resolved from the portal subdomain
 * @param {number} postId
 * @param {object} data { body, parentCommentId, submitterName, submitterEmail }
 * @param {string} lg
 */
const createPublicComment = async (tenantId, postId, data, lg) => {
  const body = (data?.body || "").trim();
  const submitterName = (data?.submitterName || "").trim().slice(0, 120) || null;
  const submitterEmail =
    (data?.submitterEmail || "").trim().slice(0, 255) || null;
  const parentCommentId = data?.parentCommentId || null;

  if (!body) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "comment_body_required", lg)
    );
  }
  if (submitterEmail && !EMAIL_RE.test(submitterEmail)) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email", lg)
    );
  }

  try {
    const [posts] = await pool.query(
      "SELECT id FROM posts WHERE id = ? AND tenant_id = ?",
      [postId, tenantId]
    );
    if (posts.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg)
      );
    }

    // A reply must target a comment on this same post/tenant.
    if (parentCommentId) {
      const [parent] = await pool.query(
        "SELECT id FROM comments WHERE id = ? AND post_id = ? AND tenant_id = ?",
        [parentCommentId, postId, tenantId]
      );
      if (parent.length === 0) {
        return Promise.reject(
          setServerResponse(API_STATUS_CODE.BAD_REQUEST, "comment_not_found", lg)
        );
      }
    }

    const [result] = await pool.query(
      `INSERT INTO comments
         (tenant_id, post_id, author_id, submitter_name, submitter_email, parent_comment_id, body)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      [tenantId, postId, submitterName, submitterEmail, parentCommentId, body]
    );

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.CREATED,
        "comment_created_successfully",
        lg,
        { id: result.insertId }
      )
    );
  } catch (error) {
    console.error("Error creating public comment:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_create_comment",
        lg
      )
    );
  }
};

module.exports = { createPublicComment };
