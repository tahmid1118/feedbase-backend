const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getUnreadCount = async (authData) => {
  const { id: userId, tenantId, lg } = authData;
  const _query = 'SELECT COUNT(*) as unread_count FROM notifications WHERE tenant_id = ? AND user_id = ? AND is_read = 0';
  try {
    const [rows] = await pool.query(_query, [tenantId, userId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'unread_count_retrieved_successfully', lg, { unreadCount: rows[0].unread_count }));
  } catch (error) {
    console.error('Error getting unread count:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_unread_count', lg));
  }
};
module.exports = { getUnreadCount };
