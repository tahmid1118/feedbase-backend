const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const publishChangelog = async (id, authData) => {
  const { tenantId, lg } = authData;
  const _query = 'UPDATE changelog_entries SET is_published = 1, published_at = NOW() WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'changelog_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'changelog_published_successfully', lg));
  } catch (error) {
    console.error('Error publishing changelog:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_publish_changelog', lg));
  }
};
module.exports = { publishChangelog };
