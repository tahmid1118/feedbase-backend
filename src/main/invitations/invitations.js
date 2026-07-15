const crypto = require("crypto");
const dns = require("dns").promises;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { createSession } = require("../../common/sessions");
const { getTenantPlan, getAccountWorkspaceUsage } = require("../../common/planGuard");
const { getPlanLimits } = require("../../consts/plans");
const { sendEmail, isMailConfigured } = require("../../common/mailer");
const { invitationEmail } = require("../../common/emails/invitationEmail");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_DAYS = 7;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const signToken = (user, sid) =>
  jwt.sign(
    { id: user.id, email: user.email, tenantId: user.tenant_id, role: user.role, sid },
    process.env.SECRET_ACCESS_TOKEN,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRE }
  );

/**
 * Is this address plausibly real? Format first, then a best-effort MX lookup so
 * typos like "gmial.com" are caught. A DNS failure (offline/rate-limited) is NOT
 * treated as invalid — we only reject when the domain resolves with no mail
 * exchanger.
 */
const isDeliverableEmail = async (email) => {
  if (!EMAIL_RE.test(email)) return false;
  const domain = email.split("@")[1];
  try {
    const mx = await dns.resolveMx(domain);
    return Array.isArray(mx) && mx.length > 0;
  } catch (e) {
    if (e && (e.code === "ENOTFOUND" || e.code === "NXDOMAIN")) return false;
    return true; // inconclusive — don't block
  }
};

/** Invite someone to the authenticated owner's workspace. */
const createInvitation = async (data, authData) => {
  const { tenantId, role, id: inviterId, lg } = authData;

  if (role !== "owner") {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.FORBIDDEN, "insufficient_permissions", lg)
    );
  }

  const email = String(data?.email || "").trim().toLowerCase();
  if (!(await isDeliverableEmail(email))) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email", lg));
  }

  try {
    // Already a member of THIS workspace?
    const [member] = await pool.query(
      "SELECT id FROM users WHERE tenant_id = ? AND email = ? LIMIT 1",
      [tenantId, email]
    );
    if (member.length > 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "already_a_member", lg)
      );
    }

    // Still-valid pending invite?
    const [existing] = await pool.query(
      "SELECT id FROM invitations WHERE tenant_id = ? AND email = ? AND status = 'pending' AND expires_at > NOW() LIMIT 1",
      [tenantId, email]
    );
    if (existing.length > 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invitation_already_sent", lg)
      );
    }

    // Seat limit: current team members + outstanding invites must stay under the
    // plan. `seats` counts members BESIDES the owner, so the owner (role='owner')
    // is excluded from the tally — Free allows owner + 2, Pro owner + 5, Business
    // unlimited.
    const plan = await getTenantPlan(tenantId);
    const seats = getPlanLimits(plan).seats;
    if (Number.isFinite(seats)) {
      const [[{ members }]] = await pool.query(
        "SELECT COUNT(*) AS members FROM users WHERE tenant_id = ? AND is_active = 1 AND role <> 'owner'",
        [tenantId]
      );
      const [[{ pending }]] = await pool.query(
        "SELECT COUNT(*) AS pending FROM invitations WHERE tenant_id = ? AND status = 'pending' AND expires_at > NOW()",
        [tenantId]
      );
      if (members + pending >= seats) {
        return Promise.reject(
          setServerResponse(API_STATUS_CODE.PAYMENT_REQUIRED, "plan_limit_seats", lg)
        );
      }
    }

    const [[tenant]] = await pool.query("SELECT name FROM tenants WHERE id = ?", [tenantId]);
    const [[inviter]] = await pool.query("SELECT full_name FROM users WHERE id = ?", [inviterId]);

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const [result] = await pool.query(
      `INSERT INTO invitations (tenant_id, email, token, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [tenantId, email, token, inviterId, expiresAt]
    );

    const acceptUrl = `${FRONTEND_URL}/invite/${token}`;
    const mail = invitationEmail({
      workspaceName: tenant?.name || "a workspace",
      inviterName: inviter?.full_name,
      acceptUrl,
      expiresInDays: INVITE_TTL_DAYS,
    });
    const delivery = await sendEmail({ to: email, ...mail });

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.CREATED, "invitation_sent", lg, {
        id: result.insertId,
        email,
        expiresAt,
        emailSent: delivery.sent,
        mailConfigured: isMailConfigured(),
      })
    );
  } catch (error) {
    console.error("createInvitation error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_send_invitation", lg)
    );
  }
};

/** Outstanding invitations for the workspace (Team tab). */
const listInvitations = async (authData) => {
  const { tenantId, lg } = authData;
  try {
    const [rows] = await pool.query(
      `SELECT id, email, status, expires_at, created_at,
              (expires_at <= NOW()) AS is_expired
       FROM invitations
       WHERE tenant_id = ? AND status = 'pending'
       ORDER BY created_at DESC`,
      [tenantId]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "data_fetched_successfully", lg, { rows })
    );
  } catch (error) {
    console.error("listInvitations error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Revoke a pending invitation (its link stops working immediately). */
const revokeInvitation = async (id, authData) => {
  const { tenantId, role, lg } = authData;
  if (role !== "owner") {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.FORBIDDEN, "insufficient_permissions", lg)
    );
  }
  try {
    const [result] = await pool.query(
      "UPDATE invitations SET status = 'revoked' WHERE id = ? AND tenant_id = ? AND status = 'pending'",
      [id, tenantId]
    );
    if (result.affectedRows === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "invitation_not_found", lg)
      );
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "invitation_revoked", lg));
  } catch (error) {
    console.error("revokeInvitation error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Load the invitation row for a token, or null. */
const findByToken = async (token) => {
  const [rows] = await pool.query(
    `SELECT i.*, t.name AS workspace_name
     FROM invitations i JOIN tenants t ON i.tenant_id = t.id
     WHERE i.token = ? LIMIT 1`,
    [String(token || "")]
  );
  return rows[0] || null;
};

/**
 * PUBLIC: describe an invitation so the accept page can render. Never leaks more
 * than the invited email + workspace name.
 */
const getInvitation = async (token, lg) => {
  try {
    const inv = await findByToken(token);
    if (!inv) {
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "data_fetched_successfully", lg, {
          valid: false,
          reason: "not_found",
        })
      );
    }
    const expired = new Date(inv.expires_at) <= new Date();
    const usable = inv.status === "pending" && !expired;

    // Does this email already have an account anywhere?
    const [acct] = await pool.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [inv.email]
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "data_fetched_successfully", lg, {
        valid: usable,
        reason: usable
          ? null
          : inv.status === "accepted"
            ? "already_accepted"
            : inv.status === "revoked"
              ? "revoked"
              : "expired",
        email: inv.email,
        workspaceName: inv.workspace_name,
        hasAccount: acct.length > 0,
      })
    );
  } catch (error) {
    console.error("getInvitation error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Shared validation + membership creation. Returns the new member row id. */
const joinWorkspace = async (conn, inv, { fullName, passwordHash, avatarUrl }) => {
  const [member] = await conn.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name, role, avatar_url, is_active)
     VALUES (?, ?, ?, ?, 'user', ?, 1)`,
    [inv.tenant_id, inv.email, passwordHash, fullName, avatarUrl || null]
  );
  await conn.query(
    "UPDATE invitations SET status = 'accepted', accepted_at = NOW(), accepted_by_user_id = ? WHERE id = ? AND status = 'pending'",
    [member.insertId, inv.id]
  );
  return member.insertId;
};

/**
 * PUBLIC: accept as a NEW user — they set their name + password here. The invite
 * link is the proof of email ownership (standard for invitations). Single-use:
 * the UPDATE only matches a still-pending row.
 */
const acceptInvitationAsNewUser = async (token, data, lg, req) => {
  const fullName = String(data?.fullName || "").trim();
  const password = String(data?.password || "");
  if (!fullName) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "full_name_required", lg));
  }
  if (password.length < 8) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "password_too_short", lg));
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT i.*, t.name AS workspace_name FROM invitations i
       JOIN tenants t ON i.tenant_id = t.id
       WHERE i.token = ? AND i.status = 'pending' AND i.expires_at > NOW()
       FOR UPDATE`,
      [String(token || "")]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invitation_invalid", lg)
      );
    }
    const inv = rows[0];

    const [existing] = await conn.query("SELECT id FROM users WHERE email = ? LIMIT 1", [inv.email]);
    if (existing.length > 0) {
      await conn.rollback();
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "account_exists_please_login", lg)
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const memberId = await joinWorkspace(conn, inv, { fullName, passwordHash });

    await conn.commit();

    // Accepting as a brand-new account is that account's first sign-in, so it
    // opens a device session (nothing else can be live for a new email).
    const sid = await createSession(inv.email, req);
    const authToken = signToken(
      { id: memberId, email: inv.email, tenant_id: inv.tenant_id, role: "user" },
      sid
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.CREATED, "invitation_accepted", lg, {
        token: authToken,
        user: {
          id: memberId,
          tenantId: inv.tenant_id,
          role: "user",
          fullName,
          email: inv.email,
          imageUrl: null,
        },
        tenant: { id: inv.tenant_id, name: inv.workspace_name },
      })
    );
  } catch (error) {
    await conn.rollback();
    console.error("acceptInvitationAsNewUser error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_accept_invitation", lg)
    );
  } finally {
    conn.release();
  }
};

/**
 * AUTHENTICATED: accept as an EXISTING account. Requires being signed in as the
 * invited email — otherwise anyone holding a forwarded link could join as them.
 * Clones the account's credentials into a member row for the invited workspace.
 */
const acceptInvitationAsExistingUser = async (token, authData) => {
  const { email: authEmail, id: authUserId, lg, sid } = authData;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT i.*, t.name AS workspace_name FROM invitations i
       JOIN tenants t ON i.tenant_id = t.id
       WHERE i.token = ? AND i.status = 'pending' AND i.expires_at > NOW()
       FOR UPDATE`,
      [String(token || "")]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invitation_invalid", lg)
      );
    }
    const inv = rows[0];

    if (String(authEmail).toLowerCase() !== String(inv.email).toLowerCase()) {
      await conn.rollback();
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.FORBIDDEN, "invitation_wrong_account", lg)
      );
    }

    const [already] = await conn.query(
      "SELECT id FROM users WHERE tenant_id = ? AND email = ? LIMIT 1",
      [inv.tenant_id, inv.email]
    );
    if (already.length > 0) {
      await conn.rollback();
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "already_a_member", lg)
      );
    }

    // Per-account cap on JOINED workspaces (governed by the invitee's own tier).
    // A new account has 0 memberships so this only bites existing accounts.
    const usage = await getAccountWorkspaceUsage(inv.email);
    if (!usage.canJoin) {
      await conn.rollback();
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.PAYMENT_REQUIRED, "plan_limit_workspaces_join", lg)
      );
    }

    const [me] = await conn.query(
      "SELECT password_hash, full_name, avatar_url FROM users WHERE id = ? LIMIT 1",
      [authUserId]
    );
    const account = me[0];

    const memberId = await joinWorkspace(conn, inv, {
      fullName: account.full_name,
      passwordHash: account.password_hash,
      avatarUrl: account.avatar_url,
    });

    await conn.commit();

    // Already signed in — joining re-scopes the SAME device session.
    const authToken = signToken(
      { id: memberId, email: inv.email, tenant_id: inv.tenant_id, role: "user" },
      sid
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "invitation_accepted", lg, {
        token: authToken,
        user: {
          id: memberId,
          tenantId: inv.tenant_id,
          role: "user",
          fullName: account.full_name,
          email: inv.email,
          imageUrl: account.avatar_url,
        },
        tenant: { id: inv.tenant_id, name: inv.workspace_name },
      })
    );
  } catch (error) {
    await conn.rollback();
    console.error("acceptInvitationAsExistingUser error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_accept_invitation", lg)
    );
  } finally {
    conn.release();
  }
};

module.exports = {
  createInvitation,
  listInvitations,
  revokeInvitation,
  getInvitation,
  acceptInvitationAsNewUser,
  acceptInvitationAsExistingUser,
};
