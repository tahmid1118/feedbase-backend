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

  // custom_domain is only touched when the field is present (an explicit empty
  // string clears it); everything else mirrors the previous behaviour.
  const fields = [
    'name = ?',
    'branding_logo_url = ?',
    'branding_primary_color = ?',
    'is_active = ?',
  ];
  const values = [name, brandingLogoUrl || null, brandingPrimaryColor || null, isActive];
  if (customDomain !== undefined) {
    fields.push('custom_domain = ?');
    values.push(wantsCustomDomain ? String(customDomain).trim() : null);
  }
  const _query = `UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);

  try {
    const [result] = await pool.query(_query, values);

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
