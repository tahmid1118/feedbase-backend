const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getIntegrationList = async (authData) => {
  const { tenantId, lg } = authData;
  const _query = 'SELECT * FROM integrations WHERE tenant_id = ? ORDER BY created_at DESC';
  try {
    const [rows] = await pool.query(_query, [tenantId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'integrations_retrieved_successfully', lg, rows));
  } catch (error) {
    console.error('Error getting integrations:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_integrations', lg));
  }
};
module.exports = { getIntegrationList };
