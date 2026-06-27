const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { syncPostStatusToColumn } = require('../../common/roadmapSync');

const addItemToRoadmap = async (itemData, authData) => {
  const { postId, roadmapColumnId, sortOrder, targetReleaseDate } = itemData;
  const { tenantId, lg } = authData;
  const _query = 'INSERT INTO roadmap_items (tenant_id, post_id, roadmap_column_id, sort_order, target_release_date) VALUES (?, ?, ?, ?, ?)';
  try {
    const [result] = await pool.query(_query, [tenantId, postId, roadmapColumnId, sortOrder || 0, targetReleaseDate || null]);
    // Placing a post in a status column (e.g. "Planned") sets its status to match.
    await syncPostStatusToColumn(tenantId, postId, roadmapColumnId);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'roadmap_item_added_successfully', lg, { id: result.insertId }));
  } catch (error) {
    console.error('Error adding roadmap item:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_add_roadmap_item', lg));
  }
};
module.exports = { addItemToRoadmap };
