const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { getPlanLimits } = require("../../consts/plans");
const cache = require("../../common/cache");

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
    SELECT id, name, slug, subdomain,
           branding_logo_url, branding_primary_color, plan_name,
           require_auth_to_post
    FROM tenants
    WHERE is_active = 1 AND subdomain = ?
    LIMIT 1
  `;

  try {
    // Every public request (board, post, changelog, vote, comment) resolves the
    // tenant first, so this is the single hottest query in the app and its
    // result — branding + a plan flag — barely ever changes. Caching it removes
    // one DB round-trip from EVERY portal request, which is what keeps the pool
    // free for the queries that actually need it under a traffic spike.
    // Invalidated on workspace update/delete (see invalidateTenantCache).
    const rows = await cache.wrap(`tenant:${value}`, cache.TTL.TENANT, async () => {
      const [result] = await pool.query(_query, [value]);
      // Only cache a hit — caching "not found" would let a typo'd subdomain
      // stay broken for the whole TTL after the workspace is created.
      return result.length > 0 ? result : undefined;
    });

    if (!rows || rows.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "tenant_not_found", lg)
      );
    }

    // Expose only plan-derived booleans — never the raw plan/billing.
    const { plan_name, require_auth_to_post, ...tenant } = rows[0];
    const limits = getPlanLimits(plan_name);
    tenant.attachments_enabled = Boolean(limits.attachments);
    // Owner comment identity: badge = "Name (Owner)" (Pro+); privacy = "Owner"
    // only / anonymous (Business). Drive the portal composer's options.
    tenant.owner_badge_enabled = Boolean(limits.ownerBadge);
    tenant.owner_privacy_enabled = Boolean(limits.ownerPrivacy);
    // EFFECTIVE requirement, not the raw stored preference — if the account
    // has since lapsed from Pro+, the stored `1` stays (so re-upgrading
    // restores the owner's choice) but enforcement (here and in
    // createPublicPost.js) silently reverts to "anonymous allowed" rather than
    // locking visitors out of a Free board.
    tenant.require_signin_to_post =
      Boolean(require_auth_to_post) && Boolean(limits.restrictAnonymousPosting);

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        "tenant_retrieved_successfully",
        lg,
        tenant
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

/**
 * Drop a tenant's cached portal record. MUST be called whenever anything the
 * public portal reads changes — branding, name, subdomain, active flag, or the
 * plan (which drives attachments_enabled) — otherwise the portal serves stale
 * branding for up to TTL.TENANT.
 *
 * Pass the OLD subdomain too when it is being renamed, so the previous key does
 * not keep resolving to the workspace.
 * @param {...(string|null|undefined)} subdomains
 */
const invalidateTenantCache = (...subdomains) => {
  for (const sub of subdomains) {
    if (!sub) continue;
    cache.invalidate(`tenant:${String(sub).trim().toLowerCase()}`);
  }
};

module.exports = { resolvePublicTenant, invalidateTenantCache };
