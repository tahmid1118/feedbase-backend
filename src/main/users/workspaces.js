const jwt = require("jsonwebtoken");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { getAccountWorkspaceUsage } = require("../../common/planGuard");
const { ensureAccount, mirrorAccountToTenants } = require("../../common/accountBilling");

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "admin",
  "dashboard",
  "api",
  "public",
]);
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

// Switching/creating a workspace re-scopes the SAME device session — it is not
// a new login, so the caller's `sid` is carried straight through.
const signToken = (user, sid) =>
  jwt.sign(
    {
      id: user.id,
      email: user.email,
      tenantId: user.tenant_id,
      role: user.role,
      sid,
    },
    process.env.SECRET_ACCESS_TOKEN,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRE }
  );

/**
 * List every workspace (tenant) the authenticated account belongs to. Identity
 * is the email, so all active user rows sharing the email are the user's
 * workspaces.
 */
const getWorkspaces = async (authData) => {
  const { email, tenantId, lg } = authData;
  try {
    const [rows] = await pool.query(
      `SELECT u.id AS user_id, u.role, t.id AS tenant_id, t.name, t.subdomain,
              t.branding_primary_color
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = ? AND u.is_active = 1 AND t.is_active = 1
       ORDER BY t.name`,
      [email]
    );
    const workspaces = rows.map((r) => ({ ...r, current: r.tenant_id === tenantId }));
    // Per-account caps (owned/joined) so the UI can gate "Add Workspace" and
    // explain why. `limits.ownLimit`/`joinLimit` are null when unlimited.
    const limits = await getAccountWorkspaceUsage(email);
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "data_fetched_successfully", lg, {
        workspaces,
        limits,
      })
    );
  } catch (error) {
    console.error("Error listing workspaces:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/**
 * Check whether a subdomain is valid (format + not reserved) and available
 * (not already used by another tenant's subdomain or slug). Used for live
 * feedback on the create-workspace forms.
 */
const checkSubdomain = async (rawSubdomain, lg) => {
  const subdomain = (rawSubdomain || "").trim().toLowerCase();
  const valid = SUBDOMAIN_RE.test(subdomain) && !RESERVED_SUBDOMAINS.has(subdomain);
  if (!valid) {
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "data_fetched_successfully", lg, {
        valid: false,
        available: false,
      })
    );
  }
  try {
    const [rows] = await pool.query(
      "SELECT id FROM tenants WHERE subdomain = ? OR slug = ? LIMIT 1",
      [subdomain, subdomain]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "data_fetched_successfully", lg, {
        valid: true,
        available: rows.length === 0,
      })
    );
  } catch (error) {
    console.error("Error checking subdomain:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/**
 * Create a new workspace (tenant) owned by the authenticated account. The owner
 * user row clones the current account's credentials, and the workspace is seeded
 * with the default status-linked roadmap columns.
 */
const createWorkspace = async (data, authData) => {
  const { id: userId, email, lg, sid } = authData;
  const name = (data?.name || "").trim();
  const subdomain = (data?.subdomain || "").trim().toLowerCase();
  const website = (data?.website || "").trim() || null;

  if (!name) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "workspace_name_required", lg)
    );
  }
  if (!SUBDOMAIN_RE.test(subdomain) || RESERVED_SUBDOMAINS.has(subdomain)) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_subdomain", lg)
    );
  }

  // Per-account cap on OWNED workspaces (governed by the account's tier — the
  // best plan it already owns). A fresh account owns 0, so its first workspace
  // is always allowed. To raise the cap, upgrade an owned workspace to Pro/Business.
  const usage = await getAccountWorkspaceUsage(email);
  if (!usage.canCreate) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.PAYMENT_REQUIRED, "plan_limit_workspaces_own", lg)
    );
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dupe] = await conn.query(
      "SELECT id FROM tenants WHERE subdomain = ? OR slug = ? LIMIT 1",
      [subdomain, subdomain]
    );
    if (dupe.length > 0) {
      await conn.rollback();
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.CONFLICT, "subdomain_taken", lg)
      );
    }

    const [me] = await conn.query(
      "SELECT email, password_hash, full_name, avatar_url, tenant_id FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (me.length === 0) {
      await conn.rollback();
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "user_not_found", lg)
      );
    }
    const account = me[0];

    // The "website" is the company's site, not a custom portal domain — store
    // it in its own (non-unique) column. custom_domain stays null and is set
    // deliberately later in Branding settings (a paid capability).
    const [tenant] = await conn.query(
      `INSERT INTO tenants (name, slug, subdomain, custom_domain, website, plan_name, branding_primary_color, is_active)
       VALUES (?, ?, ?, NULL, ?, 'free', '#c74959', 1)`,
      [name, subdomain, subdomain, website]
    );
    const newTenantId = tenant.insertId;

    // A pending account (no workspace yet) claims its existing row as the owner
    // of its first workspace; an existing member gets a fresh owner row.
    let ownerUserId;
    if (account.tenant_id === null) {
      await conn.query(
        "UPDATE users SET tenant_id = ?, role = 'owner' WHERE id = ?",
        [newTenantId, userId]
      );
      ownerUserId = userId;
    } else {
      const [owner] = await conn.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, role, avatar_url, is_active)
         VALUES (?, ?, ?, ?, 'owner', ?, 1)`,
        [newTenantId, account.email, account.password_hash, account.full_name, account.avatar_url]
      );
      ownerUserId = owner.insertId;
    }

    // A subscription is per ACCOUNT and covers every workspace it owns, so the
    // new workspace inherits the owner's account plan (a Business account's new
    // board is Business at once). Mirrors onto the just-inserted owner row.
    await ensureAccount(account.email, conn);
    await mirrorAccountToTenants(account.email, conn);

    // Seed the default status-linked roadmap columns.
    await conn.query(
      `INSERT INTO roadmap_columns (tenant_id, name, column_key, sort_order) VALUES
        (?, 'Planned', 'planned', 1),
        (?, 'In Progress', 'in_progress', 2),
        (?, 'Completed', 'completed', 3)`,
      [newTenantId, newTenantId, newTenantId]
    );

    await conn.commit();

    const token = signToken(
      {
        id: ownerUserId,
        email: account.email,
        tenant_id: newTenantId,
        role: "owner",
      },
      sid
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.CREATED, "workspace_created_successfully", lg, {
        token,
        user: {
          id: ownerUserId,
          tenantId: newTenantId,
          role: "owner",
          fullName: account.full_name,
          email: account.email,
          imageUrl: account.avatar_url,
        },
        tenant: { id: newTenantId, name, subdomain },
      })
    );
  } catch (error) {
    await conn.rollback();
    // A concurrent create can slip past the SELECT check and hit a UNIQUE
    // constraint — report the right field rather than a generic error.
    if (error && error.code === "ER_DUP_ENTRY") {
      const dupKey = String(error.sqlMessage || error.message || "");
      const msgKey = dupKey.includes("custom_domain")
        ? "custom_domain_taken"
        : "subdomain_taken";
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.CONFLICT, msgKey, lg)
      );
    }
    console.error("Error creating workspace:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_create_tenant", lg)
    );
  } finally {
    conn.release();
  }
};

/**
 * Switch the active workspace: verify the account (email) has an active user row
 * in the target tenant and issue a fresh JWT scoped to it.
 */
const switchWorkspace = async (targetTenantId, authData) => {
  const { email, lg, sid } = authData;
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.tenant_id, u.role, u.full_name, u.avatar_url
       FROM users u JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = ? AND u.tenant_id = ? AND u.is_active = 1 AND t.is_active = 1
       LIMIT 1`,
      [email, targetTenantId]
    );
    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.FORBIDDEN, "workspace_not_found", lg)
      );
    }
    const user = rows[0];
    const token = signToken(user, sid);

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "workspace_switched_successfully", lg, {
        token,
        user: {
          id: user.id,
          tenantId: user.tenant_id,
          role: user.role,
          fullName: user.full_name,
          email: user.email,
          imageUrl: user.avatar_url,
        },
      })
    );
  } catch (error) {
    console.error("Error switching workspace:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { getWorkspaces, checkSubdomain, createWorkspace, switchWorkspace };
