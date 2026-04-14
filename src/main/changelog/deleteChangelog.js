const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const deleteChangelog = async (id, authData) => {
  const { tenantId, lg } = authData;
  const _query = 'DELETE FROM changelog_entries WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'changelog_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'changelog_deleted_successfully', lg));
  } catch (error) {
    console.error('Error deleting changelog:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_delete_changelog', lg));
  }
};
module.exports = { deleteChangelog };
