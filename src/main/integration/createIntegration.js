const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { planAllows } = require('../../common/planGuard');

const createIntegration = async (integrationData, authData) => {
  const { integrationType, config } = integrationData;
  const { tenantId, lg } = authData;

  // Integrations are a paid capability.
  if (!(await planAllows(tenantId, 'integrations'))) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.PAYMENT_REQUIRED, 'plan_limit_integrations', lg)
    );
  }

  const _query = 'INSERT INTO integrations (tenant_id, integration_type, config) VALUES (?, ?, ?)';
  try {
    const [result] = await pool.query(_query, [tenantId, integrationType, JSON.stringify(config)]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'integration_created_successfully', lg, { id: result.insertId }));
  } catch (error) {
    console.error('Error creating integration:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_create_integration', lg));
  }
};
module.exports = { createIntegration };
