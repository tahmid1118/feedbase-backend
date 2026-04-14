const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const markAllAsRead = async (authData) => {
  const { id: userId, tenantId, lg } = authData;
  const _query = 'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE tenant_id = ? AND user_id = ? AND is_read = 0';
  try {
    await pool.query(_query, [tenantId, userId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'all_notifications_marked_as_read', lg));
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_mark_all_notifications_as_read', lg));
  }
};
module.exports = { markAllAsRead };
