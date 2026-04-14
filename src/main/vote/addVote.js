const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const addVote = async (postId, authData) => {
  const { id: userId, tenantId, lg } = authData;
  const _query = 'INSERT INTO votes (tenant_id, post_id, user_id, vote_type) VALUES (?, ?, ?, ?)';
  try {
    await pool.query(_query, [tenantId, postId, userId, 'upvote']);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'vote_added_successfully', lg));
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'already_voted', lg));
    }
    console.error('Error adding vote:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_add_vote', lg));
  }
};
module.exports = { addVote };
