const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { getAttachmentsForPost } = require("../attachments/attachments");

/**
 * @description Public, read-only post detail with its comment thread, scoped to
 * the resolved tenant. Author emails are not exposed.
 * @param {number} tenantId
 * @param {number} postId
 * @param {string} lg
 */
const getPublicPostDetail = async (tenantId, postId, lg) => {
  const _postQuery = `
    SELECT p.id, p.title, p.description, p.post_type, p.status, p.priority,
           p.is_pinned, p.duplicate_of_post_id, p.created_at, p.author_id, p.guest_id,
           COALESCE(u.full_name, p.submitter_name, 'Anonymous') AS author_name,
           u.avatar_url AS author_avatar,
           (SELECT COUNT(*) FROM votes WHERE post_id = p.id) AS vote_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count
    FROM posts p
    LEFT JOIN users u ON p.author_id = u.id
    WHERE p.id = ? AND p.tenant_id = ? AND p.status <> 'rejected'
  `;

  const _tagQuery = `
    SELECT t.id, t.name, t.color_hex
    FROM post_tags pt
    JOIN tags t ON pt.tag_id = t.id
    WHERE pt.post_id = ? AND pt.tenant_id = ?
  `;

  const _commentQuery = `
    SELECT c.id, c.post_id, c.parent_comment_id, c.body, c.is_edited,
           c.created_at, c.author_id, c.guest_id,
           COALESCE(u.full_name, c.submitter_name, 'Anonymous') AS author_name,
           u.avatar_url AS author_avatar
    FROM comments c
    LEFT JOIN users u ON c.author_id = u.id
    WHERE c.tenant_id = ? AND c.post_id = ?
    ORDER BY c.created_at ASC
  `;

  try {
    const [rows] = await pool.query(_postQuery, [postId, tenantId]);

    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg)
      );
    }

    const [tags] = await pool.query(_tagQuery, [postId, tenantId]);
    const [comments] = await pool.query(_commentQuery, [tenantId, postId]);
    const attachments = await getAttachmentsForPost(postId, tenantId);

    const post = { ...rows[0], tags, comments, attachments };

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        "post_retrieved_successfully",
        lg,
        post
      )
    );
  } catch (error) {
    console.error("Error getting public post:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_get_post",
        lg
      )
    );
  }
};

module.exports = { getPublicPostDetail };
