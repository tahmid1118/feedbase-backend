const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const createAuditLog = async (logData, authData) => {
  const { action, entityType, entityId, metadata, ipAddress, userAgent } = logData;
  const { id: actorUserId, tenantId, lg } = authData;
  const _query = 'INSERT INTO audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  try {
    await pool.query(_query, [tenantId, actorUserId, action, entityType, entityId || null, JSON.stringify(metadata || {}), ipAddress || null, userAgent || null]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'audit_log_created_successfully', lg));
  } catch (error) {
    console.error('Error creating audit log:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_create_audit_log', lg));
  }
};
module.exports = { createAuditLog };
