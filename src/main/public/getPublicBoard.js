const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * @description Public, read-only feedback board for a tenant. Mirrors the
 * authenticated post list but without any per-user state (no `has_voted`) and
 * without exposing author emails.
 * @param {number} tenantId resolved from the portal subdomain
 * @param {object} paginationData
 * @param {object} filters { status, postType, tagId, search }
 * @param {string} lg
 */
// Public board sort options. vote_count is the SELECT alias below.
const SORTS = {
  newest: "p.created_at DESC",
  oldest: "p.created_at ASC",
  most_voted: "vote_count DESC, p.created_at DESC",
  least_voted: "vote_count ASC, p.created_at DESC",
};

const getPublicBoard = async (tenantId, paginationData, filters, lg) => {
  const orderBy = SORTS[paginationData?.sortBy] || SORTS.newest;
  const itemsPerPage = Number(paginationData?.itemsPerPage) || 20;
  const offset = Number(paginationData?.offset) || 0;
  const searchText = (filters?.search || paginationData?.filterBy || "").trim();

  let whereClause = " WHERE p.tenant_id = ?";
  const whereParams = [tenantId];

  if (filters?.status) {
    whereClause += " AND p.status = ?";
    whereParams.push(filters.status);
  }
  if (filters?.postType) {
    whereClause += " AND p.post_type = ?";
    whereParams.push(filters.postType);
  }
  if (filters?.tagId) {
    whereClause +=
      " AND p.id IN (SELECT post_id FROM post_tags WHERE tag_id = ? AND tenant_id = ?)";
    whereParams.push(filters.tagId, tenantId);
  }
  if (searchText) {
    whereClause += " AND (p.title LIKE ? OR p.description LIKE ?)";
    const likeText = `%${searchText}%`;
    whereParams.push(likeText, likeText);
  }

  const _query =
    `SELECT p.id, p.title, p.description, p.post_type, p.status, p.priority,
            p.is_pinned, p.created_at,
            COALESCE(u.full_name, p.submitter_name, 'Anonymous') AS author_name,
            (SELECT COUNT(*) FROM votes WHERE post_id = p.id) AS vote_count,
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
            (SELECT COUNT(*) FROM post_attachments WHERE post_id = p.id) AS attachment_count,
            (SELECT storage_path FROM post_attachments
              WHERE post_id = p.id AND kind = 'image' ORDER BY id ASC LIMIT 1) AS thumbnail_path
     FROM posts p
     LEFT JOIN users u ON p.author_id = u.id` +
    whereClause +
    ` ORDER BY p.is_pinned DESC, ${orderBy} LIMIT ? OFFSET ?`;
  const listParams = [...whereParams, itemsPerPage, offset];

  const _countQuery = "SELECT COUNT(*) AS total FROM posts p" + whereClause;

  try {
    const [rows] = await pool.query(_query, listParams);
    const [countResult] = await pool.query(_countQuery, whereParams);

    let posts = rows.map((row) => ({ ...row, tags: [] }));
    if (posts.length > 0) {
      const postIds = posts.map((p) => p.id);
      const [tagRows] = await pool.query(
        `SELECT pt.post_id, t.id, t.name, t.color_hex
         FROM post_tags pt
         JOIN tags t ON pt.tag_id = t.id
         WHERE pt.tenant_id = ? AND pt.post_id IN (?)`,
        [tenantId, postIds]
      );
      const tagsByPost = tagRows.reduce((acc, t) => {
        (acc[t.post_id] = acc[t.post_id] || []).push({
          id: t.id,
          name: t.name,
          color_hex: t.color_hex,
        });
        return acc;
      }, {});
      posts = posts.map((p) => ({ ...p, tags: tagsByPost[p.id] || [] }));
    }

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "posts_retrieved_successfully", lg, {
        posts,
        total: countResult[0].total,
      })
    );
  } catch (error) {
    console.error("Error getting public board:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_get_posts",
        lg
      )
    );
  }
};

module.exports = { getPublicBoard };
