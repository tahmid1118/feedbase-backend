const jwt = require('jsonwebtoken');
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { placeholderImagePath } = require("../../consts/staticValues");
const { startSession } = require('../../common/sessions');

const VALID_PROVIDERS = ['google', 'facebook', 'github', 'microsoft'];

const USER_FIELDS =
  'id, tenant_id, full_name, email, role, avatar_url, is_platform_admin';

const generateToken = (userInfo, sid) => {
  return jwt.sign(
    {
      id: userInfo.id,
      email: userInfo.email,
      tenantId: userInfo.tenant_id,
      role: userInfo.role,
      sid,
    },
    process.env.SECRET_ACCESS_TOKEN,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRE }
  );
};

/**
 * Pick the row to sign this account in as.
 *
 * An account is an email that may hold a `users` row per workspace, plus
 * possibly a workspace-LESS row left from before onboarding. Prefer a row that
 * HAS a workspace: signing the platform admin (who holds both) into their
 * NULL-tenant row would bounce them to onboarding even though they own a board.
 * The workspace switcher takes over from there.
 */
const findAccountRow = async (email) => {
  const [rows] = await pool.query(
    `SELECT ${USER_FIELDS} FROM users
      WHERE email = ? AND is_active = 1
      ORDER BY (tenant_id IS NULL), id
      LIMIT 1`,
    [email]
  );
  return rows[0] || null;
};

const getUserById = async (userId) => {
  const [rows] = await pool.query(
    `SELECT ${USER_FIELDS} FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

/**
 * @description Sign in (or sign up) with a social provider. The frontend runs
 * the provider handshake — NextAuth verifies the ID token, state and nonce — and
 * posts the resulting identity here, so this endpoint never handles the user's
 * provider credentials.
 *
 * Two rules make an assertion from the frontend safe to accept:
 *
 *  1. `emailVerified` MUST be true. We match an existing account BY EMAIL, so an
 *     unverified provider address is an account-takeover route: anyone able to
 *     put an arbitrary address on a provider profile could claim a FeedBoard
 *     account they don't own. Google reports this for the `email` scope; some
 *     providers don't, and those must not be enabled without another check.
 *  2. The provider's SUBJECT ID is the identity, not the email. Once linked, a
 *     person who changes the address on their provider account still signs in to
 *     the same FeedBoard account instead of silently forking a second one.
 *
 * A first-time user is provisioned with NO workspace (`tenant_id` NULL) and NO
 * password, exactly like an email signup — the frontend then routes them to
 * onboarding to create their first workspace. It must never fall back to a
 * tenant id: an earlier version defaulted to `1`, which would have dropped every
 * new social signup into whichever workspace happened to be first.
 */
const oauthLogin = async (userData, lg, req) => {
  const language = userData?.lg || lg || 'en';
  const provider = (userData?.provider || '').toLowerCase();
  const providerUserId = userData?.providerUserId;
  const email = String(userData?.email || '').trim().toLowerCase();
  const fullName = (userData?.fullName || '').trim() || email;
  const avatarUrl = userData?.avatarUrl || placeholderImagePath;

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
  if (userData?.emailVerified !== true && userData?.emailVerified !== 'true') {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'oauth_email_unverified', language)
    );
  }

  try {
    // 1) Known provider identity → the account it was linked to. The STORED
    //    email wins over the one just presented, so changing the address on the
    //    provider side doesn't fork a second FeedBoard account.
    const [linkRows] = await pool.query(
      'SELECT email FROM oauth_accounts WHERE provider = ? AND provider_user_id = ? LIMIT 1',
      [provider, providerUserId]
    );
    const accountEmail = linkRows[0]?.email || email;

    let userInfo = await findAccountRow(accountEmail);

    // 2) No account yet → provision one, workspace-less and password-less. The
    //    frontend sends them to onboarding, which claims this row as the owner
    //    of the workspace they create.
    if (!userInfo) {
      const [insert] = await pool.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, role, avatar_url, is_active)
         VALUES (NULL, ?, NULL, ?, 'user', ?, 1)`,
        [accountEmail, fullName, avatarUrl]
      );
      userInfo = await getUserById(insert.insertId);
    }

    if (!userInfo) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'failed_to_process_oauth_login', language)
      );
    }

    // 3) Remember the link. INSERT IGNORE so a concurrent first login that won
    //    the race is not an error.
    if (linkRows.length === 0) {
      await pool.query(
        'INSERT IGNORE INTO oauth_accounts (email, provider, provider_user_id) VALUES (?, ?, ?)',
        [accountEmail, provider, providerUserId]
      );
    }

    // 4) One device at a time (Free/Pro) — the same gate as password login, so
    //    social sign-in cannot be used to sidestep it. `force` is the confirmed
    //    takeover after a 409.
    const force = userData?.force === true || userData?.force === 'true';
    const session = await startSession(userInfo, req, { force });
    if (session.blocked) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.CONFLICT, 'already_logged_in_elsewhere', language)
      );
    }

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userInfo.id]);

    const token = generateToken(userInfo, session.sessionId);
    const user = {
      token,
      id: userInfo.id,
      tenantId: userInfo.tenant_id,
      fullName: userInfo.full_name,
      email: userInfo.email,
      role: userInfo.role,
      imageUrl: userInfo.avatar_url,
      isPlatformAdmin: userInfo.is_platform_admin === 1,
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
