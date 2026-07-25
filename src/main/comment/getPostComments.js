const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getPostComments = async (postId, authData) => {
  const { tenantId, lg } = authData;
  const _query = "SELECT c.*, CASE WHEN c.as_owner = 1 AND u.role = 'owner' AND u.tenant_id = c.tenant_id THEN NULL ELSE COALESCE(u.full_name, c.submitter_name, 'Anonymous') END as author_name, COALESCE(u.email, c.submitter_email) as author_email, (c.as_owner = 1 AND u.role = 'owner' AND u.tenant_id = c.tenant_id) AS author_as_owner, EXISTS (SELECT 1 FROM users a WHERE a.email = u.email AND a.is_platform_admin = 1 AND a.is_active = 1) AS author_is_admin FROM comments c LEFT JOIN users u ON c.author_id = u.id WHERE c.tenant_id = ? AND c.post_id = ? ORDER BY c.created_at ASC";
  try {
    const [rows] = await pool.query(_query, [tenantId, postId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'comments_retrieved_successfully', lg, rows));
  } catch (error) {
    console.error('Error getting comments:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_comments', lg));
  }
};
module.exports = { getPostComments };
