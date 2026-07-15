const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updateTenant = async (id, tenantData, lg) => {
  const { name, brandingLogoUrl, brandingPrimaryColor, isActive } = tenantData;
  // NOTE: plan_name is controlled exclusively by Stripe billing (checkout +
  // webhook) and is intentionally NOT updatable through this endpoint.
  // Custom domains are not a feature — `custom_domain` is never written here.

  // Only update columns the caller actually provided. A blanket `SET col = ?`
  // with an undefined value clobbers existing data — notably, the Branding form
  // doesn't send isActive, so always writing is_active would deactivate the
  // workspace (hiding it from the switcher and the public portal).
  const fields = [];
  const values = [];
  if (name !== undefined) {
    fields.push('name = ?');
    values.push(name);
  }
  if (brandingLogoUrl !== undefined) {
    fields.push('branding_logo_url = ?');
    values.push(brandingLogoUrl || null);
  }
  if (brandingPrimaryColor !== undefined) {
    fields.push('branding_primary_color = ?');
    values.push(brandingPrimaryColor || null);
  }
  if (isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(isActive ? 1 : 0);
  }

  if (fields.length === 0) {
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, 'tenant_updated_successfully', lg)
    );
  }

  const _query = `UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);

  try {
    await pool.query(_query, values);

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
