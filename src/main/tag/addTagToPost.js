const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const addTagToPost = async (postId, tagId, authData) => {
  const { tenantId, lg } = authData;
  const _query = 'INSERT INTO post_tags (tenant_id, post_id, tag_id) VALUES (?, ?, ?)';
  try {
    await pool.query(_query, [tenantId, postId, tagId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'tag_added_to_post_successfully', lg));
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'tag_already_added', lg));
    }
    console.error('Error adding tag to post:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_add_tag_to_post', lg));
  }
};
module.exports = { addTagToPost };
