const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * @description Look up an active tenant by its subdomain or custom domain.
 * Used to resolve the tenant for the public, unauthenticated portal.
 * Returns only branding-safe fields (no internal/billing data).
 * @param {string} identifier subdomain (e.g. "acme") or custom domain
 * @param {string} lg
 */
const resolvePublicTenant = async (identifier, lg) => {
  const value = (identifier || "").trim().toLowerCase();

  if (!value) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "tenant_not_found", lg)
    );
  }

  const _query = `
    SELECT id, name, slug, subdomain, custom_domain,
           branding_logo_url, branding_primary_color
    FROM tenants
    WHERE is_active = 1 AND (subdomain = ? OR custom_domain = ?)
    LIMIT 1
  `;

  try {
    const [rows] = await pool.query(_query, [value, value]);

    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "tenant_not_found", lg)
      );
    }

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        "tenant_retrieved_successfully",
        lg,
        rows[0]
      )
    );
  } catch (error) {
    console.error("Error resolving public tenant:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_get_tenant",
        lg
      )
    );
  }
};

module.exports = { resolvePublicTenant };
