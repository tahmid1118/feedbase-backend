const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { syncRoadmapItemToStatus } = require("../../common/roadmapSync");

const STATUSES = ["open", "planned", "in_progress", "completed", "closed", "rejected"];

/** List a workspace's feedback posts (admin moderation view). */
const listWorkspacePosts = async (tenantId, filters, lg) => {
  try {
    const params = [tenantId];
    let where = "WHERE p.tenant_id = ?";
    if (filters?.status && STATUSES.includes(filters.status)) {
      where += " AND p.status = ?";
      params.push(filters.status);
    }
    const search = (filters?.search || "").trim();
    if (search) {
      where += " AND (p.title LIKE ? OR p.description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await pool.query(
      `SELECT p.id, p.title, p.description, p.post_type, p.status, p.priority,
              p.is_pinned, p.created_at,
              COALESCE(u.full_name, p.submitter_name, 'Anonymous') AS author_name,
              (SELECT COUNT(*) FROM votes WHERE post_id = p.id) AS vote_count,
              (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count
       FROM posts p
       LEFT JOIN users u ON p.author_id = u.id
       ${where}
       ORDER BY p.is_pinned DESC, p.created_at DESC
       LIMIT 300`,
      params
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { rows })
    );
  } catch (error) {
    console.error("admin listWorkspacePosts error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Set a post's status (keeps the roadmap in sync, like the dashboard). */
const setPostStatus = async (tenantId, postId, status, lg) => {
  if (!STATUSES.includes(status)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_status", lg));
  }
  try {
    const [result] = await pool.query(
      "UPDATE posts SET status = ? WHERE id = ? AND tenant_id = ?",
      [status, postId, tenantId]
    );
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg));
    }
    await syncRoadmapItemToStatus(tenantId, postId, status);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "post_updated", lg));
  } catch (error) {
    console.error("admin setPostStatus error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Pin / unpin a post. */
const setPostPin = async (tenantId, postId, isPinned, lg) => {
  try {
    const [result] = await pool.query(
      "UPDATE posts SET is_pinned = ? WHERE id = ? AND tenant_id = ?",
      [isPinned ? 1 : 0, postId, tenantId]
    );
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "post_updated", lg));
  } catch (error) {
    console.error("admin setPostPin error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Delete a post (and its votes/comments via FK cascade). */
const deleteWorkspacePost = async (tenantId, postId, lg) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM posts WHERE id = ? AND tenant_id = ?",
      [postId, tenantId]
    );
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "post_deleted", lg));
  } catch (error) {
    console.error("admin deleteWorkspacePost error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { listWorkspacePosts, setPostStatus, setPostPin, deleteWorkspacePost };
