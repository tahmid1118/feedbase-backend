const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { resetPostStatusToOpen } = require('../../common/roadmapSync');

const removeItemFromRoadmap = async (id, authData) => {
  const { tenantId, lg } = authData;
  try {
    // Capture the linked post before deleting so we can reset its status.
    const [rows] = await pool.query(
      'SELECT post_id FROM roadmap_items WHERE id = ? AND tenant_id = ?',
      [id, tenantId]
    );
    const [result] = await pool.query(
      'DELETE FROM roadmap_items WHERE id = ? AND tenant_id = ?',
      [id, tenantId]
    );
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'roadmap_item_not_found', lg));
    }
    // Dismissing a post from the roadmap returns it to the Open tab.
    if (rows[0]?.post_id) {
      await resetPostStatusToOpen(tenantId, rows[0].post_id);
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'roadmap_item_removed_successfully', lg));
  } catch (error) {
    console.error('Error removing roadmap item:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_remove_roadmap_item', lg));
  }
};
module.exports = { removeItemFromRoadmap };
