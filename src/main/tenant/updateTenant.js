const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { planAllows } = require('../../common/planGuard');

const updateTenant = async (id, tenantData, lg) => {
  const { name, brandingLogoUrl, brandingPrimaryColor, customDomain, isActive } = tenantData;
  // NOTE: plan_name is controlled exclusively by Stripe billing (checkout +
  // webhook) and is intentionally NOT updatable through this endpoint.

  // A custom domain is a paid capability — gate it before writing.
  const wantsCustomDomain =
    customDomain !== undefined &&
    customDomain !== null &&
    String(customDomain).trim() !== "";
  if (wantsCustomDomain && !(await planAllows(id, 'customDomain'))) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.PAYMENT_REQUIRED, 'plan_limit_custom_domain', lg)
    );
  }

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
  if (customDomain !== undefined) {
    fields.push('custom_domain = ?');
    values.push(wantsCustomDomain ? String(customDomain).trim() : null);
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
