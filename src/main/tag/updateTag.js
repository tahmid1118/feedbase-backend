const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updateTag = async (id, tagData, authData) => {
  const { name, colorHex } = tagData;
  const { tenantId, lg } = authData;
  const _query = 'UPDATE tags SET name = ?, color_hex = ? WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [name, colorHex, id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'tag_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'tag_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating tag:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_tag', lg));
  }
};
module.exports = { updateTag };
