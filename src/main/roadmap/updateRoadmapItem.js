const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { syncPostStatusToColumn } = require('../../common/roadmapSync');

const updateRoadmapItem = async (id, itemData, authData) => {
  const { roadmapColumnId, sortOrder, targetReleaseDate } = itemData;
  const { tenantId, lg } = authData;

  // Only update the fields that were actually supplied. A move sends just the
  // column/order, so we must not overwrite target_release_date with null.
  const sets = [];
  const values = [];
  if (roadmapColumnId !== undefined) {
    sets.push('roadmap_column_id = ?');
    values.push(roadmapColumnId);
  }
  if (sortOrder !== undefined) {
    sets.push('sort_order = ?');
    values.push(sortOrder);
  }
  if (targetReleaseDate !== undefined) {
    sets.push('target_release_date = ?');
    values.push(targetReleaseDate);
  }

  if (sets.length === 0) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'failed_to_update_roadmap_item', lg)
    );
  }

  const _query = `UPDATE roadmap_items SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`;
  values.push(id, tenantId);
  try {
    const [result] = await pool.query(_query, values);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'roadmap_item_not_found', lg));
    }
    // Dragging an item into a status column updates the post's status to match.
    if (roadmapColumnId !== undefined) {
      const [rows] = await pool.query(
        'SELECT post_id FROM roadmap_items WHERE id = ? AND tenant_id = ?',
        [id, tenantId]
      );
      if (rows[0]) {
        await syncPostStatusToColumn(tenantId, rows[0].post_id, roadmapColumnId);
      }
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'roadmap_item_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating roadmap item:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_roadmap_item', lg));
  }
};
module.exports = { updateRoadmapItem };
