const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getPostList = async (paginationData, filters, authData) => {
  const { tenantId, lg } = authData;
  const sortOrder = paginationData?.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const filterBy = (paginationData?.filterBy || '').trim();
  const itemsPerPage = Number(paginationData?.itemsPerPage) || 10;
  const offset = Number(paginationData?.offset) || 0;
  
  let _query = 'SELECT p.*, u.full_name as author_name, (SELECT COUNT(*) FROM votes WHERE post_id = p.id) as vote_count FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.tenant_id = ?';
  const params = [tenantId];
  
  if (filters?.status) { _query += ' AND p.status = ?'; params.push(filters.status); }
  if (filters?.postType) { _query += ' AND p.post_type = ?'; params.push(filters.postType); }
  if (filterBy) {
    _query += ' AND (p.title LIKE ? OR p.description LIKE ?)';
    const likeText = `%${filterBy}%`;
    params.push(likeText, likeText);
  }
  
  _query += ` ORDER BY p.created_at ${sortOrder} LIMIT ? OFFSET ?`;
  params.push(itemsPerPage, offset);
  
  try {
    const [rows] = await pool.query(_query, params);
    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM posts WHERE tenant_id = ?', [tenantId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'posts_retrieved_successfully', lg, { posts: rows, total: countResult[0].total }));
  } catch (error) {
    console.error('Error getting posts:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_posts', lg));
  }
};
module.exports = { getPostList };
