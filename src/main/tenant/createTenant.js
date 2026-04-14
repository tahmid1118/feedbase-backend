const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const createTenant = async (tenantData, lg) => {
  const { name, slug, subdomain, customDomain, planName, brandingLogoUrl, brandingPrimaryColor } = tenantData;

  const _query = `
    INSERT INTO tenants (name, slug, subdomain, custom_domain, plan_name, branding_logo_url, branding_primary_color)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    const [result] = await pool.query(_query, [
      name, slug, subdomain, customDomain || null, planName || 'free',
      brandingLogoUrl || null, brandingPrimaryColor || null
    ]);

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.CREATED,
        'tenant_created_successfully',
        lg,
        { id: result.insertId }
      )
    );
  } catch (error) {
    console.error('Error creating tenant:', error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        'failed_to_create_tenant',
        lg
      )
    );
  }
};

module.exports = { createTenant };
