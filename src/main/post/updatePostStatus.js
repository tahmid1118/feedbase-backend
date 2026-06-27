const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { syncRoadmapItemToStatus } = require('../../common/roadmapSync');

const updatePostStatus = async (id, newStatus, authData) => {
  const { tenantId, lg } = authData;
  const _query = 'UPDATE posts SET status = ? WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [newStatus, id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'post_not_found', lg));
    }
    // Keep the roadmap in sync: move the post's item into the matching column.
    await syncRoadmapItemToStatus(tenantId, id, newStatus);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'post_status_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating post status:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_post_status', lg));
  }
};
module.exports = { updatePostStatus };
