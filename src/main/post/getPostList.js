const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getPostList = async (paginationData, filters, authData) => {
  const { id: userId, tenantId, lg } = authData;
  const sortOrder = paginationData?.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const itemsPerPage = Number(paginationData?.itemsPerPage) || 10;
  const offset = Number(paginationData?.offset) || 0;

  // Search term can come from paginationData.filterBy (legacy) or filters.search (preferred).
  const searchText = (filters?.search || paginationData?.filterBy || '').trim();

  // Build the shared WHERE clause + params so the list and count queries stay in sync.
  let whereClause = ' WHERE p.tenant_id = ?';
  const whereParams = [tenantId];

  if (filters?.status) { whereClause += ' AND p.status = ?'; whereParams.push(filters.status); }
  if (filters?.postType) { whereClause += ' AND p.post_type = ?'; whereParams.push(filters.postType); }
  if (filters?.isPinned !== undefined && filters?.isPinned !== null && filters?.isPinned !== '') {
    whereClause += ' AND p.is_pinned = ?';
    whereParams.push(filters.isPinned ? 1 : 0);
  }
  if (filters?.tagId) {
    whereClause += ' AND p.id IN (SELECT post_id FROM post_tags WHERE tag_id = ? AND tenant_id = ?)';
    whereParams.push(filters.tagId, tenantId);
  }
  if (searchText) {
    whereClause += ' AND (p.title LIKE ? OR p.description LIKE ?)';
    const likeText = `%${searchText}%`;
    whereParams.push(likeText, likeText);
  }

  const _query =
    `SELECT p.*, COALESCE(u.full_name, p.submitter_name, 'Anonymous') as author_name,
            (SELECT COUNT(*) FROM votes WHERE post_id = p.id) as vote_count,
            EXISTS(SELECT 1 FROM votes WHERE post_id = p.id AND user_id = ?) as has_voted
     FROM posts p
     LEFT JOIN users u ON p.author_id = u.id` +
    whereClause +
    ` ORDER BY p.is_pinned DESC, p.created_at ${sortOrder} LIMIT ? OFFSET ?`;
  const listParams = [userId, ...whereParams, itemsPerPage, offset];

  const _countQuery = 'SELECT COUNT(*) as total FROM posts p' + whereClause;

  try {
    const [rows] = await pool.query(_query, listParams);
    const [countResult] = await pool.query(_countQuery, whereParams);

    // Attach tags to each post in a single round-trip.
    let posts = rows.map((row) => ({ ...row, has_voted: row.has_voted === 1, tags: [] }));
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
        (acc[t.post_id] = acc[t.post_id] || []).push({ id: t.id, name: t.name, color_hex: t.color_hex });
        return acc;
      }, {});
      posts = posts.map((p) => ({ ...p, tags: tagsByPost[p.id] || [] }));
    }

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, 'posts_retrieved_successfully', lg, {
        posts,
        total: countResult[0].total,
      })
    );
  } catch (error) {
    console.error('Error getting posts:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_posts', lg));
  }
};
module.exports = { getPostList };
