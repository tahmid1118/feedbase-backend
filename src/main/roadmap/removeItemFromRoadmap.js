const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const removeItemFromRoadmap = async (id, authData) => {
  const { tenantId, lg } = authData;
  const _query = 'DELETE FROM roadmap_items WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'roadmap_item_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'roadmap_item_removed_successfully', lg));
  } catch (error) {
    console.error('Error removing roadmap item:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_remove_roadmap_item', lg));
  }
};
module.exports = { removeItemFromRoadmap };
