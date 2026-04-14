const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getApiKeyList = async (authData) => {
  const { tenantId, lg } = authData;
  const _query = 'SELECT id, key_name, key_prefix, scopes, last_used_at, expires_at, is_revoked, created_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC';
  try {
    const [rows] = await pool.query(_query, [tenantId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'api_keys_retrieved_successfully', lg, rows));
  } catch (error) {
    console.error('Error getting API keys:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_api_keys', lg));
  }
};
module.exports = { getApiKeyList };
