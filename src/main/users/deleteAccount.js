const bcrypt = require("bcrypt");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { purgeAccount } = require("../../common/accountDeletion");

/**
 * Account deletion (customer-initiated).
 *
 * Re-authenticates, then hands off to `common/accountDeletion.purgeAccount` —
 * the same cascade the Admin Panel uses, so the two paths can't drift. See that
 * module for what a purge destroys and why (owned workspaces, anonymised
 * content in joined ones, provider-agnostic subscription cancellation, and
 * every account-keyed row).
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

    // Social-only accounts have no password, so the dialog must not ask for one.
    const [pw] = await pool.query(
      "SELECT 1 FROM users WHERE email = ? AND password_hash IS NOT NULL LIMIT 1",
      [email]
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "data_fetched_successfully", lg, {
        email,
        hasPassword: pw.length > 0,
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

const deleteAccount = async (password, authData) => {
  const { id: currentUserId, email, lg } = authData;

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

    // An account created through social sign-in has NO password, so there is
    // nothing to re-verify — demanding one would make it undeletable. The typed
    // confirmation word in the dialog is the barrier for those accounts. Anyone
    // who wants the password step back can set one via "Forgot password", which
    // works for password-less accounts precisely so this isn't a one-way door.
    const hasPassword = Boolean(me[0].password_hash);
    if (hasPassword) {
      if (!password) {
        return Promise.reject(
          setServerResponse(API_STATUS_CODE.BAD_REQUEST, "password_required", lg)
        );
      }
      const ok = await bcrypt.compare(password, me[0].password_hash);
      if (!ok) {
        return Promise.reject(
          setServerResponse(API_STATUS_CODE.BAD_REQUEST, "incorrect_password", lg)
        );
      }
    }

    // A platform admin deleting their own account would take /admin-login with
    // it, so `purgeAccount` is allowed to proceed here only because the caller
    // has re-authenticated — the flag guard is for the ADMIN panel deleting
    // someone else. Keep it on: an operator who wants to leave should demote
    // themselves under Admins first, deliberately.
    const result = await purgeAccount(email);

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "account_deleted", lg, {
        deletedWorkspaces: result.deletedWorkspaces,
        leftWorkspaces: result.leftWorkspaces,
      })
    );
  } catch (error) {
    if (error?.code === "platform_admin_undeletable") {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "platform_admin_undeletable", lg)
      );
    }
    console.error("deleteAccount error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_delete_account", lg)
    );
  }
};

module.exports = { getAccountDeletionSummary, deleteAccount };
