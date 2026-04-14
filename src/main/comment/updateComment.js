const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updateComment = async (id, body, authData) => {
  const { tenantId, lg } = authData;
  const _query = 'UPDATE comments SET body = ?, is_edited = 1 WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [body, id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'comment_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'comment_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating comment:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_comment', lg));
  }
};
module.exports = { updateComment };
