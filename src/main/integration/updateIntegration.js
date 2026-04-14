const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updateIntegration = async (id, integrationData, authData) => {
  const { config } = integrationData;
  const { tenantId, lg } = authData;
  const _query = 'UPDATE integrations SET config = ? WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [JSON.stringify(config), id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'integration_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'integration_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating integration:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_integration', lg));
  }
};
module.exports = { updateIntegration };
