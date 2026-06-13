const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

/**
 * @description Mark a post as a duplicate of another post, or clear the mark.
 * Pass `duplicateOfPostId` as null to clear. The target must exist in the same
 * tenant and cannot be the post itself.
 */
const setPostDuplicate = async (id, duplicateOfPostId, authData) => {
  const { tenantId, lg } = authData;

  try {
    const [postRows] = await pool.query(
      'SELECT id FROM posts WHERE id = ? AND tenant_id = ?',
      [id, tenantId]
    );
    if (postRows.length === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'post_not_found', lg));
    }

    const clearing =
      duplicateOfPostId === undefined || duplicateOfPostId === null || duplicateOfPostId === '';

    if (!clearing) {
      if (Number(duplicateOfPostId) === Number(id)) {
        return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'invalid_duplicate_target', lg));
      }
      const [targetRows] = await pool.query(
        'SELECT id FROM posts WHERE id = ? AND tenant_id = ?',
        [duplicateOfPostId, tenantId]
      );
      if (targetRows.length === 0) {
        return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'invalid_duplicate_target', lg));
      }
    }

    await pool.query('UPDATE posts SET duplicate_of_post_id = ? WHERE id = ? AND tenant_id = ?', [
      clearing ? null : duplicateOfPostId,
      id,
      tenantId,
    ]);

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        clearing ? 'duplicate_cleared_successfully' : 'post_marked_as_duplicate',
        lg
      )
    );
  } catch (error) {
    console.error('Error setting post duplicate:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_duplicate', lg));
  }
};

module.exports = { setPostDuplicate };
