const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const markAsRead = async (id, authData) => {
  const { id: userId, tenantId, lg } = authData;
  const _query = 'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND tenant_id = ? AND user_id = ?';
  try {
    const [result] = await pool.query(_query, [id, tenantId, userId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'notification_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'notification_marked_as_read', lg));
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_mark_notification_as_read', lg));
  }
};
module.exports = { markAsRead };
