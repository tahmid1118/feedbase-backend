const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getNotifications = async (paginationData, authData) => {
  const { id: userId, tenantId, lg } = authData;
  const sortOrder = paginationData?.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const filterBy = (paginationData?.filterBy || '').trim();
  const itemsPerPage = Number(paginationData?.itemsPerPage) || 20;
  const offset = Number(paginationData?.offset) || 0;

  let _query = 'SELECT * FROM notifications WHERE tenant_id = ? AND user_id = ?';
  const queryParams = [tenantId, userId];

  if (filterBy) {
    _query += ' AND (title LIKE ? OR message LIKE ? OR notification_type LIKE ?)';
    const likeText = `%${filterBy}%`;
    queryParams.push(likeText, likeText, likeText);
  }

  _query += ` ORDER BY created_at ${sortOrder} LIMIT ? OFFSET ?`;
  queryParams.push(itemsPerPage, offset);

  try {
    const [rows] = await pool.query(_query, queryParams);
    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM notifications WHERE tenant_id = ? AND user_id = ?', [tenantId, userId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'notifications_retrieved_successfully', lg, { notifications: rows, total: countResult[0].total }));
  } catch (error) {
    console.error('Error getting notifications:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_notifications', lg));
  }
};
module.exports = { getNotifications };
