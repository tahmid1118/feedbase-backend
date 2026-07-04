const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

const POST_TYPES = ["feedback", "feature_request", "bug_report"];

/** Fetch a row's owner within a tenant, or null if it doesn't exist. */
const ownedRow = async (table, id, tenantId) => {
  const [rows] = await pool.query(
    `SELECT id, author_id FROM ${table} WHERE id = ? AND tenant_id = ?`,
    [id, tenantId]
  );
  return rows[0] || null;
};

const owns = (row, authUser) =>
  authUser && row.author_id != null && Number(row.author_id) === Number(authUser.id);

/** Edit your own feedback post (title/details/type). */
const updatePublicPost = async (tenantId, postId, data, authUser, lg) => {
  const row = await ownedRow("posts", postId, tenantId);
  if (!row) return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg));
  if (!owns(row, authUser)) return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, "not_your_content", lg));

  const title = (data?.title || "").trim();
  if (!title) return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "title_required", lg));
  const description = (data?.description || "").trim();

  const fields = ["title = ?", "description = ?"];
  const vals = [title, description];
  if (POST_TYPES.includes(data?.postType)) {
    fields.push("post_type = ?");
    vals.push(data.postType);
  }
  await pool.query(
    `UPDATE posts SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
    [...vals, postId, tenantId]
  );
  return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "post_updated_successfully", lg));
};

/** Delete your own feedback post (cascades to its votes/comments). */
const deletePublicPost = async (tenantId, postId, authUser, lg) => {
  const row = await ownedRow("posts", postId, tenantId);
  if (!row) return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg));
  if (!owns(row, authUser)) return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, "not_your_content", lg));

  await pool.query("DELETE FROM posts WHERE id = ? AND tenant_id = ?", [postId, tenantId]);
  return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "post_deleted_successfully", lg));
};

/** Edit your own comment. */
const updatePublicComment = async (tenantId, commentId, data, authUser, lg) => {
  const row = await ownedRow("comments", commentId, tenantId);
  if (!row) return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "comment_not_found", lg));
  if (!owns(row, authUser)) return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, "not_your_content", lg));

  const body = (data?.body || "").trim();
  if (!body) return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "comment_body_required", lg));

  await pool.query(
    "UPDATE comments SET body = ?, is_edited = 1 WHERE id = ? AND tenant_id = ?",
    [body, commentId, tenantId]
  );
  return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "comment_updated_successfully", lg));
};

/** Delete your own comment (cascades to its replies). */
const deletePublicComment = async (tenantId, commentId, authUser, lg) => {
  const row = await ownedRow("comments", commentId, tenantId);
  if (!row) return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "comment_not_found", lg));
  if (!owns(row, authUser)) return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, "not_your_content", lg));

  await pool.query("DELETE FROM comments WHERE id = ? AND tenant_id = ?", [commentId, tenantId]);
  return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "comment_deleted_successfully", lg));
};

module.exports = {
  updatePublicPost,
  deletePublicPost,
  updatePublicComment,
  deletePublicComment,
};
