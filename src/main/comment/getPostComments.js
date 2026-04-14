const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getPostComments = async (postId, authData) => {
  const { tenantId, lg } = authData;
  const _query = 'SELECT c.*, u.full_name as author_name, u.email as author_email FROM comments c LEFT JOIN users u ON c.author_id = u.id WHERE c.tenant_id = ? AND c.post_id = ? ORDER BY c.created_at ASC';
  try {
    const [rows] = await pool.query(_query, [tenantId, postId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'comments_retrieved_successfully', lg, rows));
  } catch (error) {
    console.error('Error getting comments:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_comments', lg));
  }
};
module.exports = { getPostComments };
