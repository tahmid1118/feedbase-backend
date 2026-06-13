const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

/**
 * @description Pin or unpin a post. When `isPinned` is omitted the current value is toggled.
 */
const updatePostPin = async (id, isPinned, authData) => {
  const { tenantId, lg } = authData;

  try {
    const [rows] = await pool.query(
      'SELECT is_pinned FROM posts WHERE id = ? AND tenant_id = ?',
      [id, tenantId]
    );
    if (rows.length === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'post_not_found', lg));
    }

    const nextPinned =
      isPinned === undefined || isPinned === null ? (rows[0].is_pinned ? 0 : 1) : (isPinned ? 1 : 0);

    await pool.query('UPDATE posts SET is_pinned = ? WHERE id = ? AND tenant_id = ?', [
      nextPinned,
      id,
      tenantId,
    ]);

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        nextPinned ? 'post_pinned_successfully' : 'post_unpinned_successfully',
        lg,
        { id: Number(id), isPinned: nextPinned === 1 }
      )
    );
  } catch (error) {
    console.error('Error updating post pin:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_pin', lg));
  }
};

module.exports = { updatePostPin };
