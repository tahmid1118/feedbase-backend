const jwt = require('jsonwebtoken');
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { placeholderImagePath } = require("../../consts/staticValues");

const VALID_PROVIDERS = ['google', 'github', 'microsoft'];

const resolveTenantId = (tenantId) => {
  if (tenantId === undefined || tenantId === null || tenantId === '') {
    return 1;
  }
  const parsed = Number(tenantId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
};

const generateToken = (userInfo) => {
  return jwt.sign(
    {
      id: userInfo.id,
      email: userInfo.email,
      tenantId: userInfo.tenant_id,
      role: userInfo.role,
    },
    process.env.SECRET_ACCESS_TOKEN,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRE }
  );
};

const getUserById = async (userId) => {
  const [rows] = await pool.query(
    'SELECT id, tenant_id, full_name, email, role, avatar_url FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
    [userId]
  );
  return rows[0] || null;
};

/**
 * @description Authenticate a user via an OAuth provider. The frontend performs the
 * provider handshake and passes the verified provider identity here. The user is
 * matched by an existing oauth link, then by email within the tenant, otherwise a
 * new user is provisioned. A JWT is returned in the same shape as password login.
 */
const oauthLogin = async (userData, lg) => {
  const language = userData?.lg || lg || 'en';
  const provider = (userData?.provider || '').toLowerCase();
  const providerUserId = userData?.providerUserId;
  const email = userData?.email;
  const fullName = userData?.fullName || email;
  const avatarUrl = userData?.avatarUrl || placeholderImagePath;
  const tenantId = resolveTenantId(userData?.tenantId);

  if (!VALID_PROVIDERS.includes(provider)) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'invalid_oauth_provider', language)
    );
  }
  if (!providerUserId || !email) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'oauth_provider_is_required', language)
    );
  }

  try {
    // 1) Existing oauth link.
    const [linkRows] = await pool.query(
      'SELECT user_id FROM oauth_accounts WHERE tenant_id = ? AND provider = ? AND provider_user_id = ? LIMIT 1',
      [tenantId, provider, providerUserId]
    );

    let userInfo;
    if (linkRows.length > 0) {
      userInfo = await getUserById(linkRows[0].user_id);
    }

    // 2) Match by email within tenant, creating the user if needed, then link.
    if (!userInfo) {
      const [userRows] = await pool.query(
        'SELECT id, tenant_id, full_name, email, role, avatar_url FROM users WHERE email = ? AND tenant_id = ? LIMIT 1',
        [email, tenantId]
      );

      if (userRows.length > 0) {
        userInfo = userRows[0];
      } else {
        const [insertResult] = await pool.query(
          `INSERT INTO users (tenant_id, email, password_hash, full_name, role, avatar_url, is_active)
           VALUES (?, ?, NULL, ?, 'user', ?, 1)`,
          [tenantId, email, fullName, avatarUrl]
        );
        userInfo = await getUserById(insertResult.insertId);
      }

      // Link the oauth identity (ignore if already linked by a race).
      await pool.query(
        'INSERT IGNORE INTO oauth_accounts (tenant_id, user_id, provider, provider_user_id) VALUES (?, ?, ?, ?)',
        [tenantId, userInfo.id, provider, providerUserId]
      );
    }

    if (!userInfo) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'failed_to_process_oauth_login', language)
      );
    }

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userInfo.id]);

    const token = generateToken(userInfo);
    const user = {
      token,
      id: userInfo.id,
      tenantId: userInfo.tenant_id,
      fullName: userInfo.full_name,
      email: userInfo.email,
      role: userInfo.role,
      imageUrl: userInfo.avatar_url,
    };

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, 'oauth_login_successful', language, user)
    );
  } catch (error) {
    console.error('OAuth login error:', error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_process_oauth_login', language)
    );
  }
};

module.exports = { oauthLogin };
