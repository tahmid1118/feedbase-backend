const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getAuditLogs = async (paginationData, filters, authData) => {
  const { tenantId, lg } = authData;
  const sortOrder = paginationData?.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const filterBy = (paginationData?.filterBy || '').trim();
  const itemsPerPage = Number(paginationData?.itemsPerPage) || 20;
  const offset = Number(paginationData?.offset) || 0;
  
  let _query = 'SELECT a.*, u.full_name as actor_name FROM audit_logs a LEFT JOIN users u ON a.actor_user_id = u.id WHERE a.tenant_id = ?';
  const params = [tenantId];
  
  if (filters?.action) { _query += ' AND a.action = ?'; params.push(filters.action); }
  if (filters?.entityType) { _query += ' AND a.entity_type = ?'; params.push(filters.entityType); }
  if (filterBy) {
    _query += ' AND (a.action LIKE ? OR a.entity_type LIKE ?)';
    const likeText = `%${filterBy}%`;
    params.push(likeText, likeText);
  }
  
  _query += ` ORDER BY a.created_at ${sortOrder} LIMIT ? OFFSET ?`;
  params.push(itemsPerPage, offset);
  
  try {
    const [rows] = await pool.query(_query, params);
    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM audit_logs WHERE tenant_id = ?', [tenantId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'audit_logs_retrieved_successfully', lg, { logs: rows, total: countResult[0].total }));
  } catch (error) {
    console.error('Error getting audit logs:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_audit_logs', lg));
  }
};
module.exports = { getAuditLogs };
