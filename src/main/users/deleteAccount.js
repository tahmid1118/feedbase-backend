const bcrypt = require("bcrypt");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { stripe, isStripeConfigured } = require("../../common/stripe");

/**
 * Account deletion.
 *
 * An account is an EMAIL with one `users` row per workspace it belongs to. So
 * deleting the account means:
 *   - workspaces it OWNS  → deleted outright (a workspace has exactly one owner
 *     and there's no ownership transfer, so it can't be left orphaned). Any
 *     Stripe subscription is cancelled first so billing stops.
 *   - workspaces it JOINED → only the membership row is removed; the workspace
 *     and its data survive.
 *
 * Content in a *joined* workspace belongs to that workspace, not to the leaver,
 * so we don't destroy it: posts/comments are ANONYMISED (author_id → NULL) and
 * things that can't be null (changelog entries, API keys, uploads) are REASSIGNED
 * to that workspace's owner. Without this the delete would fail outright — those
 * FKs are ON DELETE RESTRICT.
 */

/** What would be destroyed — shown in the confirmation dialog before deleting. */
const getAccountDeletionSummary = async (authData) => {
  const { email, lg } = authData;
  try {
    const [rows] = await pool.query(
      `SELECT u.id AS user_id, u.role, t.id AS tenant_id, t.name,
              (SELECT COUNT(*) FROM users  WHERE tenant_id = t.id) AS member_count,
              (SELECT COUNT(*) FROM posts  WHERE tenant_id = t.id) AS post_count
       FROM users u JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = ?`,
      [email]
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "data_fetched_successfully", lg, {
        email,
        ownedWorkspaces: rows
          .filter((r) => r.role === "owner")
          .map((r) => ({
            id: r.tenant_id,
            name: r.name,
            memberCount: r.member_count,
            postCount: r.post_count,
          })),
        memberWorkspaces: rows
          .filter((r) => r.role !== "owner")
          .map((r) => ({ id: r.tenant_id, name: r.name })),
      })
    );
  } catch (error) {
    console.error("getAccountDeletionSummary error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Best-effort: stop billing on a workspace we're about to delete. */
const cancelSubscription = async (subscriptionId) => {
  if (!subscriptionId || !isStripeConfigured()) return;
  try {
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (e) {
    console.error("cancelSubscription failed (non-fatal):", e.message);
  }
};

const deleteAccount = async (password, authData) => {
  const { id: currentUserId, email, lg } = authData;

  if (!password) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "password_required", lg)
    );
  }

  try {
    // Re-authenticate: a hijacked session must not be able to nuke the account.
    const [me] = await pool.query(
      "SELECT password_hash FROM users WHERE id = ? LIMIT 1",
      [currentUserId]
    );
    if (me.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "user_not_found", lg)
      );
    }
    const ok = await bcrypt.compare(password, me[0].password_hash || "");
    if (!ok) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "incorrect_password", lg)
      );
    }

    const [rows] = await pool.query(
      "SELECT id, tenant_id, role FROM users WHERE email = ?",
      [email]
    );
    const ownedTenantIds = rows.filter((r) => r.role === "owner").map((r) => r.tenant_id);
    const memberRows = rows.filter((r) => r.role !== "owner");

    // Cancel billing on owned workspaces before they disappear.
    if (ownedTenantIds.length > 0) {
      const [subs] = await pool.query(
        "SELECT stripe_subscription_id FROM tenants WHERE id IN (?) AND stripe_subscription_id IS NOT NULL",
        [ownedTenantIds]
      );
      for (const s of subs) await cancelSubscription(s.stripe_subscription_id);
    }

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

        // Nullable authorship → anonymise (keeps the post/comment in the board).
        await conn.query("UPDATE posts SET author_id = NULL WHERE author_id = ?", [m.id]);
        await conn.query("UPDATE comments SET author_id = NULL WHERE author_id = ?", [m.id]);

        // NOT NULL + RESTRICT → hand over to the workspace owner.
        if (ownerId) {
          await conn.query(
            "UPDATE changelog_entries SET created_by = ? WHERE created_by = ?",
            [ownerId, m.id]
          );
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

      // Owned workspaces go entirely (FK cascade clears their data + members).
      if (ownedTenantIds.length > 0) {
        await conn.query("DELETE FROM tenants WHERE id IN (?)", [ownedTenantIds]);
      }

      // Any leftover rows for this email, plus invitations addressed to it.
      await conn.query("DELETE FROM users WHERE email = ?", [email]);
      await conn.query("DELETE FROM invitations WHERE email = ?", [email]);
      // The account is gone — so are its device sessions, on every device.
      await conn.query("DELETE FROM user_sessions WHERE email = ?", [email]);

      await conn.commit();

      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "account_deleted", lg, {
          deletedWorkspaces: ownedTenantIds.length,
          leftWorkspaces: memberRows.length,
        })
      );
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("deleteAccount error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_delete_account", lg)
    );
  }
};

module.exports = { getAccountDeletionSummary, deleteAccount };
