const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

/** Delete every notification belonging to the authenticated user (their own inbox). */
const clearAllNotifications = async (authData) => {
  const { id: userId, tenantId, lg } = authData;
  const _query =
    'DELETE FROM notifications WHERE tenant_id = ? AND user_id = ?';
  try {
    const [result] = await pool.query(_query, [tenantId, userId]);
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, 'all_notifications_cleared', lg, {
        deleted: result.affectedRows,
      })
    );
  } catch (error) {
    console.error('Error clearing notifications:', error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        'failed_to_clear_notifications',
        lg
      )
    );
  }
};

module.exports = { clearAllNotifications };
