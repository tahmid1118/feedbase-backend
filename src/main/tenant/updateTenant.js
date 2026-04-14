const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updateTenant = async (id, tenantData, lg) => {
  const { name, brandingLogoUrl, brandingPrimaryColor, planName, isActive } = tenantData;

  const _query = `
    UPDATE tenants 
    SET name = ?, branding_logo_url = ?, branding_primary_color = ?, 
        plan_name = ?, is_active = ?
    WHERE id = ?
  `;

  try {
    const [result] = await pool.query(_query, [
      name, brandingLogoUrl || null, brandingPrimaryColor || null,
      planName, isActive, id
    ]);

    if (result.affectedRows === 0) {
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
        'tenant_updated_successfully',
        lg
      )
    );
  } catch (error) {
    console.error('Error updating tenant:', error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        'failed_to_update_tenant',
        lg
      )
    );
  }
};

module.exports = { updateTenant };
