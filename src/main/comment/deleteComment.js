const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const deleteComment = async (id, authData) => {
  const { id: userId, tenantId, role, lg } = authData;
  // A comment may be deleted by its AUTHOR, or by the workspace OWNER (moderation).
  // A regular member cannot delete someone else's comment. Always tenant-scoped.
  const isOwner = role === 'owner';
  const _query = isOwner
    ? 'DELETE FROM comments WHERE id = ? AND tenant_id = ?'
    : 'DELETE FROM comments WHERE id = ? AND tenant_id = ? AND author_id = ?';
  const _values = isOwner ? [id, tenantId] : [id, tenantId, userId];
  try {
    const [result] = await pool.query(_query, _values);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, 'not_your_content', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'comment_deleted_successfully', lg));
  } catch (error) {
    console.error('Error deleting comment:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_delete_comment', lg));
  }
};
module.exports = { deleteComment };
