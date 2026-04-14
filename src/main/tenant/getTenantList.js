const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getTenantList = async (lg) => {
  const _query = `
    SELECT id, name, slug, subdomain, custom_domain, plan_name, 
           is_active, created_at
    FROM tenants
    ORDER BY created_at DESC
  `;

  try {
    const [rows] = await pool.query(_query);

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        'tenants_retrieved_successfully',
        lg,
        rows
      )
    );
  } catch (error) {
    console.error('Error getting tenant list:', error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        'failed_to_get_tenants',
        lg
      )
    );
  }
};

module.exports = { getTenantList };
