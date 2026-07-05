const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/** List a post's comments (flat, oldest-first) for admin moderation. */
const listPostComments = async (tenantId, postId, lg) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.body, c.parent_comment_id, c.is_edited, c.created_at,
              c.author_id,
              COALESCE(u.full_name, c.submitter_name, 'Anonymous') AS author_name
       FROM comments c
       LEFT JOIN users u ON c.author_id = u.id
       WHERE c.tenant_id = ? AND c.post_id = ?
       ORDER BY c.created_at ASC`,
      [tenantId, postId]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { rows })
    );
  } catch (error) {
    console.error("admin listPostComments error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Edit a comment's body (marks it edited). */
const editComment = async (tenantId, commentId, body, lg) => {
  const text = String(body || "").trim();
  if (!text) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "comment_body_required", lg));
  }
  try {
    const [result] = await pool.query(
      "UPDATE comments SET body = ?, is_edited = 1 WHERE id = ? AND tenant_id = ?",
      [text, commentId, tenantId]
    );
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "comment_not_found", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "comment_updated", lg));
  } catch (error) {
    console.error("admin editComment error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/**
 * Delete a comment. If it's a top-level comment, its replies (which point to it)
 * go with it — matching the portal's two-level thread model.
 */
const deleteComment = async (tenantId, commentId, lg) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM comments WHERE tenant_id = ? AND (id = ? OR parent_comment_id = ?)",
      [tenantId, commentId, commentId]
    );
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "comment_not_found", lg));
    }
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "comment_deleted", lg, {
        removed: result.affectedRows,
      })
    );
  } catch (error) {
    console.error("admin deleteComment error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { listPostComments, editComment, deleteComment };
