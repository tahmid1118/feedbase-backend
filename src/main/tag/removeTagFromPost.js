const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const removeTagFromPost = async (postId, tagId, authData) => {
  const { tenantId, lg } = authData;
  const _query = 'DELETE FROM post_tags WHERE tenant_id = ? AND post_id = ? AND tag_id = ?';
  try {
    const [result] = await pool.query(_query, [tenantId, postId, tagId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'tag_not_found_on_post', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'tag_removed_from_post_successfully', lg));
  } catch (error) {
    console.error('Error removing tag from post:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_remove_tag_from_post', lg));
  }
};
module.exports = { removeTagFromPost };
