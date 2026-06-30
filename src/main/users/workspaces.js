const jwt = require("jsonwebtoken");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "admin",
  "dashboard",
  "api",
  "public",
]);
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

const signToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      email: user.email,
      tenantId: user.tenant_id,
      role: user.role,
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
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "data_fetched_successfully", lg, {
        workspaces,
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
  const { id: userId, lg } = authData;
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

    const [tenant] = await conn.query(
      `INSERT INTO tenants (name, slug, subdomain, custom_domain, plan_name, branding_primary_color, is_active)
       VALUES (?, ?, ?, ?, 'free', '#c74959', 1)`,
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

    // Seed the default status-linked roadmap columns.
    await conn.query(
      `INSERT INTO roadmap_columns (tenant_id, name, column_key, sort_order) VALUES
        (?, 'Planned', 'planned', 1),
        (?, 'In Progress', 'in_progress', 2),
        (?, 'Completed', 'completed', 3)`,
      [newTenantId, newTenantId, newTenantId]
    );

    await conn.commit();

    const token = signToken({
      id: ownerUserId,
      email: account.email,
      tenant_id: newTenantId,
      role: "owner",
    });

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
    // A concurrent create can slip past the SELECT check and hit the UNIQUE
    // constraint — treat that as "subdomain taken" rather than a generic error.
    if (error && error.code === "ER_DUP_ENTRY") {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.CONFLICT, "subdomain_taken", lg)
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
  const { email, lg } = authData;
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
    const token = signToken(user);

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
