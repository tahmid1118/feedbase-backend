const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getPostVotes = async (postId, authData) => {
  const { tenantId, lg } = authData;
  const _query = 'SELECT v.*, u.full_name, u.email FROM votes v LEFT JOIN users u ON v.user_id = u.id WHERE v.tenant_id = ? AND v.post_id = ?';
  try {
    const [rows] = await pool.query(_query, [tenantId, postId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'votes_retrieved_successfully', lg, rows));
  } catch (error) {
    console.error('Error getting votes:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_votes', lg));
  }
};
module.exports = { getPostVotes };
