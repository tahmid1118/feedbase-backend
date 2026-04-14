const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updateApiKey = async (id, apiKeyData, authData) => {
  const { keyName, scopes } = apiKeyData;
  const { tenantId, lg } = authData;
  const _query = 'UPDATE api_keys SET key_name = ?, scopes = ? WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [keyName, JSON.stringify(scopes), id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'api_key_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'api_key_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating API key:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_api_key', lg));
  }
};
module.exports = { updateApiKey };
