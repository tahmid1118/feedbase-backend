const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updateRoadmapItem = async (id, itemData, authData) => {
  const { roadmapColumnId, sortOrder, targetReleaseDate } = itemData;
  const { tenantId, lg } = authData;
  const _query = 'UPDATE roadmap_items SET roadmap_column_id = ?, sort_order = ?, target_release_date = ? WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [roadmapColumnId, sortOrder, targetReleaseDate, id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'roadmap_item_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'roadmap_item_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating roadmap item:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_roadmap_item', lg));
  }
};
module.exports = { updateRoadmapItem };
