const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updateChangelog = async (id, changelogData, authData) => {
  const { title, summary, content } = changelogData;
  const { tenantId, lg } = authData;
  const _query = 'UPDATE changelog_entries SET title = ?, summary = ?, content = ? WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [title, summary, content, id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'changelog_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'changelog_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating changelog:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_changelog', lg));
  }
};
module.exports = { updateChangelog };
