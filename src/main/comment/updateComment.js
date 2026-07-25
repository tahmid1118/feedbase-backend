const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updateComment = async (id, body, authData) => {
  const { id: userId, tenantId, lg } = authData;
  // A comment may only be EDITED by its author — not by other members of the
  // workspace. Scoped by tenant AND author_id (from the verified token).
  const _query =
    'UPDATE comments SET body = ?, is_edited = 1 WHERE id = ? AND tenant_id = ? AND author_id = ?';
  try {
    const [result] = await pool.query(_query, [body, id, tenantId, userId]);
    if (result.affectedRows === 0) {
      // Either the comment doesn't exist in this tenant, or it isn't the caller's.
      return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, 'not_your_content', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'comment_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating comment:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_comment', lg));
  }
};
module.exports = { updateComment };
