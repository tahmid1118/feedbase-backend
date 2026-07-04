const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @description Add a comment to a post from the PUBLIC portal. If `authUser` is
 * set (a logged-in viewer), the comment is attributed to that user (author_id);
 * otherwise it's a guest comment (author_id NULL + optional submitter name/email).
 * Supports threaded replies via `parentCommentId`.
 * @param {number} tenantId resolved from the portal subdomain
 * @param {number} postId
 * @param {object} data { body, parentCommentId, submitterName, submitterEmail }
 * @param {object|null} authUser req.auth when logged in, else null
 * @param {string} lg
 */
const createPublicComment = async (tenantId, postId, data, authUser, lg) => {
  const body = (data?.body || "").trim();
  const authorId = authUser?.id || null;
  // Logged-in comments carry no guest name/email — the identity is the user.
  const submitterName = authorId
    ? null
    : (data?.submitterName || "").trim().slice(0, 120) || null;
  const submitterEmail = authorId
    ? null
    : (data?.submitterEmail || "").trim().slice(0, 255) || null;
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

    // A reply must target a comment on this same post/tenant. Comments are kept
    // two levels deep: a reply always attaches to the TOP-LEVEL comment, so
    // replying to a reply joins that comment's flat thread (never nests deeper).
    let rootParentId = null;
    if (parentCommentId) {
      const [parent] = await pool.query(
        "SELECT id, parent_comment_id FROM comments WHERE id = ? AND post_id = ? AND tenant_id = ?",
        [parentCommentId, postId, tenantId]
      );
      if (parent.length === 0) {
        return Promise.reject(
          setServerResponse(API_STATUS_CODE.BAD_REQUEST, "comment_not_found", lg)
        );
      }
      let current = parent[0];
      const seen = new Set();
      while (current.parent_comment_id && !seen.has(current.id)) {
        seen.add(current.id);
        const [up] = await pool.query(
          "SELECT id, parent_comment_id FROM comments WHERE id = ? AND tenant_id = ?",
          [current.parent_comment_id, tenantId]
        );
        if (up.length === 0) break;
        current = up[0];
      }
      rootParentId = current.id;
    }

    const [result] = await pool.query(
      `INSERT INTO comments
         (tenant_id, post_id, author_id, submitter_name, submitter_email, parent_comment_id, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, postId, authorId, submitterName, submitterEmail, rootParentId, body]
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
