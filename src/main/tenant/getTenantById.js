const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getTenantById = async (id, lg) => {
  const _query = `
    SELECT id, name, slug, subdomain, custom_domain, plan_name, 
           branding_logo_url, branding_primary_color, is_active, 
           created_at, updated_at
    FROM tenants
    WHERE id = ?
  `;

  try {
    const [rows] = await pool.query(_query, [id]);
    
    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(
          API_STATUS_CODE.NOT_FOUND,
          'tenant_not_found',
          lg
        )
      );
    }

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        'tenant_retrieved_successfully',
        lg,
        rows[0]
      )
    );
  } catch (error) {
    console.error('Error getting tenant:', error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        'failed_to_get_tenant',
        lg
      )
    );
  }
};

module.exports = { getTenantById };
