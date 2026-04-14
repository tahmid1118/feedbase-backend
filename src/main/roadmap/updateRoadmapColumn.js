const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updateRoadmapColumn = async (id, columnData, authData) => {
  const { name, sortOrder } = columnData;
  const { tenantId, lg } = authData;
  const _query = 'UPDATE roadmap_columns SET name = ?, sort_order = ? WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [name, sortOrder, id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'roadmap_column_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'roadmap_column_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating roadmap column:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_roadmap_column', lg));
  }
};
module.exports = { updateRoadmapColumn };
