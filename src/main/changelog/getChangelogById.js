const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getChangelogById = async (id, authData) => {
  const { tenantId, lg } = authData;
  const _query = 'SELECT c.*, u.full_name as created_by_name FROM changelog_entries c LEFT JOIN users u ON c.created_by = u.id WHERE c.id = ? AND c.tenant_id = ?';
  try {
    const [rows] = await pool.query(_query, [id, tenantId]);
    if (rows.length === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'changelog_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'changelog_retrieved_successfully', lg, rows[0]));
  } catch (error) {
    console.error('Error getting changelog:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_changelog', lg));
  }
};
module.exports = { getChangelogById };
