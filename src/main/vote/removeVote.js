const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const removeVote = async (postId, authData) => {
  const { id: userId, tenantId, lg } = authData;
  const _query = 'DELETE FROM votes WHERE tenant_id = ? AND post_id = ? AND user_id = ?';
  try {
    const [result] = await pool.query(_query, [tenantId, postId, userId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'vote_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'vote_removed_successfully', lg));
  } catch (error) {
    console.error('Error removing vote:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_remove_vote', lg));
  }
};
module.exports = { removeVote };
