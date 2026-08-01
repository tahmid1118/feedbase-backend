const { pool } = require("../../database/dbPool");
const { cancelActiveSubscription } = require("./accountBilling");

/**
 * The ONE correct way to erase an account, shared by the customer-facing
 * "Delete account" flow and the Admin Panel's user delete.
 *
 * An account is an EMAIL with one `users` row per workspace it belongs to, so a
 * clean delete is never a single `DELETE FROM users`. That naive delete is what
 * left workspace `fire-world` alive with no owner: it either fails outright
 * (posts.author_id / changelog.created_by / api_keys.created_by /
 * file_uploads.uploaded_by are ON DELETE RESTRICT) or succeeds and strands the
 * workspace, the billing_accounts row, the device sessions — and a live
 * subscription that keeps charging a customer who no longer exists.
 *
 * What a purge does, in order:
 *   1. Cancel the account's subscription on the ACTIVE provider (Paddle or
 *      Stripe) so billing stops. Best-effort and done BEFORE the transaction —
 *      a provider outage must not roll back the delete, and an uncancelled
 *      subscription is worse than a retryable leftover row.
 *   2. Workspaces it OWNS → deleted outright. A workspace has exactly one owner
 *      and there is no ownership transfer, so it cannot be left orphaned. The
 *      tenant FK cascade clears posts, comments, roadmap, changelog, members.
 *   3. Workspaces it JOINED → membership row only. That content belongs to the
 *      workspace, not the leaver: posts/comments are ANONYMISED (author_id →
 *      NULL) and the NOT NULL + RESTRICT rows are REASSIGNED to that
 *      workspace's owner.
 *   4. Every account-keyed row for the email: users, billing_accounts,
 *      user_sessions, password_resets, invitations.
 *
 * Deliberately NOT deleted: `promo_redemptions`. It is the abuse ledger behind
 * "a code is redeemable once per account" — clearing it would let someone
 * delete their account and re-redeem the same code. (Rows for an OWNED
 * workspace still go, via the tenant cascade.) `support_sessions` /
 * `support_messages` are ON DELETE SET NULL so the admin keeps the transcript.
 */

/** A platform admin must not be deletable as an ordinary user. */
const isPlatformAdminEmail = async (email) => {
  const [rows] = await pool.query(
    "SELECT 1 FROM users WHERE email = ? AND is_platform_admin = 1 LIMIT 1",
    [email]
  );
  return rows.length > 0;
};

/**
 * Exactly what a purge would destroy — rendered in the confirmation dialog so a
 * destructive action is never taken blind.
 */
const getAccountPurgeSummary = async (email) => {
  const [rows] = await pool.query(
    `SELECT u.id AS user_id, u.role, u.is_platform_admin, t.id AS tenant_id, t.name,
            (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) AS member_count,
            (SELECT COUNT(*) FROM posts WHERE tenant_id = t.id) AS post_count
       FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id
      WHERE u.email = ?`,
    [email]
  );

  const [acct] = await pool.query(
    `SELECT plan_name, subscription_status, paddle_subscription_id, stripe_subscription_id
       FROM billing_accounts WHERE email = ? LIMIT 1`,
    [email]
  );
  const billing = acct[0] || null;

  return {
    email,
    isPlatformAdmin: rows.some((r) => r.is_platform_admin === 1),
    ownedWorkspaces: rows
      .filter((r) => r.role === "owner" && r.tenant_id)
      .map((r) => ({
        id: r.tenant_id,
        name: r.name,
        memberCount: r.member_count,
        postCount: r.post_count,
      })),
    memberWorkspaces: rows
      .filter((r) => r.role !== "owner" && r.tenant_id)
      .map((r) => ({ id: r.tenant_id, name: r.name })),
    // A row with no workspace is a real state (signed up, never onboarded).
    workspacelessRows: rows.filter((r) => !r.tenant_id).length,
    billing: billing
      ? {
          plan: billing.plan_name,
          status: billing.subscription_status,
          hasLiveSubscription: Boolean(
            billing.paddle_subscription_id || billing.stripe_subscription_id
          ),
        }
      : null,
  };
};

/**
 * Erase the account. Returns what was destroyed.
 * Throws `platform_admin_undeletable` unless `allowPlatformAdmin` is set —
 * deleting the flagged row locks everyone out of /admin-login, because the flag
 * is what that route authenticates against.
 */
const purgeAccount = async (email, { allowPlatformAdmin = false } = {}) => {
  if (!allowPlatformAdmin && (await isPlatformAdminEmail(email))) {
    const err = new Error("platform_admin_undeletable");
    err.code = "platform_admin_undeletable";
    throw err;
  }

  const [rows] = await pool.query(
    "SELECT id, tenant_id, role FROM users WHERE email = ?",
    [email]
  );
  if (rows.length === 0) {
    const err = new Error("user_not_found");
    err.code = "user_not_found";
    throw err;
  }

  const ownedTenantIds = rows
    .filter((r) => r.role === "owner" && r.tenant_id)
    .map((r) => r.tenant_id);
  const memberRows = rows.filter((r) => r.role !== "owner" && r.tenant_id);

  // Stop billing FIRST. Outside the transaction on purpose: this is a network
  // call to Paddle/Stripe, and a live subscription outliving the account is a
  // real charge to a real card, so it must not be undone by a later rollback.
  await cancelActiveSubscription(email);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Leave joined workspaces without gutting their content.
    for (const m of memberRows) {
      const [owner] = await conn.query(
        "SELECT id FROM users WHERE tenant_id = ? AND role = 'owner' LIMIT 1",
        [m.tenant_id]
      );
      const ownerId = owner[0]?.id ?? null;

      // Nullable authorship → anonymise (the post/comment stays on the board).
      await conn.query("UPDATE posts SET author_id = NULL WHERE author_id = ?", [m.id]);
      await conn.query("UPDATE comments SET author_id = NULL WHERE author_id = ?", [m.id]);

      // NOT NULL + RESTRICT → hand over to the workspace owner, or the DELETE
      // below fails and takes the whole purge with it.
      if (ownerId) {
        await conn.query("UPDATE changelog_entries SET created_by = ? WHERE created_by = ?", [
          ownerId,
          m.id,
        ]);
        await conn.query("UPDATE api_keys SET created_by = ? WHERE created_by = ?", [
          ownerId,
          m.id,
        ]);
        await conn.query("UPDATE file_uploads SET uploaded_by = ? WHERE uploaded_by = ?", [
          ownerId,
          m.id,
        ]);
      }

      await conn.query("DELETE FROM users WHERE id = ?", [m.id]);
    }

    // Owned workspaces go entirely (tenant FK cascade clears their data).
    if (ownedTenantIds.length > 0) {
      await conn.query("DELETE FROM tenants WHERE id IN (?)", [ownedTenantIds]);
    }

    // Everything keyed by the email itself, including any workspace-less row.
    await conn.query("DELETE FROM users WHERE email = ?", [email]);
    await conn.query("DELETE FROM billing_accounts WHERE email = ?", [email]);
    await conn.query("DELETE FROM user_sessions WHERE email = ?", [email]);
    await conn.query("DELETE FROM password_resets WHERE email = ?", [email]);
    await conn.query("DELETE FROM invitations WHERE email = ?", [email]);

    await conn.commit();

    return {
      email,
      deletedWorkspaces: ownedTenantIds.length,
      leftWorkspaces: memberRows.length,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = { purgeAccount, getAccountPurgeSummary, isPlatformAdminEmail };
