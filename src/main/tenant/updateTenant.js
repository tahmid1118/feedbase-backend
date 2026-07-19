const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { invalidateTenantCache } = require('../public/resolvePublicTenant');

// Mirrors the create-workspace rules (src/main/users/workspaces.js).
const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "admin", "dashboard", "api", "public",
]);
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

const updateTenant = async (id, tenantData, lg) => {
  const { name, brandingLogoUrl, brandingPrimaryColor, subdomain, isActive } = tenantData;
  // NOTE: plan_name is controlled exclusively by Stripe billing (checkout +
  // webhook) and is intentionally NOT updatable through this endpoint.
  // Custom domains are not a feature — `custom_domain` is never written here.

  // Only update columns the caller actually provided. A blanket `SET col = ?`
  // with an undefined value clobbers existing data — notably, the Branding form
  // doesn't send isActive, so always writing is_active would deactivate the
  // workspace (hiding it from the switcher and the public portal).
  const fields = [];
  const values = [];
  // Track the subdomain(s) whose cached portal record this write invalidates.
  // The OLD one matters as much as the new: after a rename the previous key
  // must stop resolving to this workspace.
  const touchedSubdomains = [];
  if (name !== undefined) {
    fields.push('name = ?');
    values.push(name);
  }

  // Changing the subdomain (the portal host) — validate + ensure it's free.
  // `slug` is kept equal to `subdomain` (as at creation), and both are unique.
  if (subdomain !== undefined) {
    const sub = String(subdomain).trim().toLowerCase();
    const [[current]] = await pool.query(
      "SELECT subdomain FROM tenants WHERE id = ?",
      [id]
    );
    if (!current) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, 'tenant_not_found', lg)
      );
    }
    touchedSubdomains.push(current.subdomain, sub);
    if (sub !== current.subdomain) {
      if (!SUBDOMAIN_RE.test(sub) || RESERVED_SUBDOMAINS.has(sub)) {
        return Promise.reject(
          setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'invalid_subdomain', lg)
        );
      }
      const [taken] = await pool.query(
        "SELECT id FROM tenants WHERE (subdomain = ? OR slug = ?) AND id != ? LIMIT 1",
        [sub, sub, id]
      );
      if (taken.length > 0) {
        return Promise.reject(
          setServerResponse(API_STATUS_CODE.CONFLICT, 'subdomain_taken', lg)
        );
      }
      fields.push('subdomain = ?', 'slug = ?');
      values.push(sub, sub);
    }
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

    // Branding/name/active changes must show on the public portal immediately,
    // not after the cache TTL expires. When only non-subdomain fields changed we
    // don't know the subdomain yet, so look it up once and drop that key.
    if (touchedSubdomains.length === 0) {
      const [[row]] = await pool.query(
        "SELECT subdomain FROM tenants WHERE id = ?",
        [id]
      );
      if (row) touchedSubdomains.push(row.subdomain);
    }
    invalidateTenantCache(...touchedSubdomains);

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        'tenant_updated_successfully',
        lg
      )
    );
  } catch (error) {
    // A concurrent change can slip past the SELECT and hit the UNIQUE index.
    if (error && error.code === 'ER_DUP_ENTRY') {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.CONFLICT, 'subdomain_taken', lg)
      );
    }
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
