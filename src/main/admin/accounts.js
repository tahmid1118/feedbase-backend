const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const {
  getAccount,
  setAccountPlan,
  resetAccountToFree,
  cancelActiveSubscription,
} = require("../../common/accountBilling");
const { PLANS: PLAN_CONFIG, PLAN_RANK } = require("../../consts/plans");
const { sendEmail, MAIL_FROM_SUPPORT } = require("../../common/mailer");
const { planChangedEmail } = require("../../common/emails/planChangedEmail");

const PLANS = ["free", "pro", "business"];

/**
 * Tell the account owner their plan changed. Fire-and-forget from the caller's
 * point of view (never awaited by setAccountPlanAdmin) — a mail provider outage
 * must not make an admin's plan grant appear to fail, and the admin already
 * sees the change reflected in the table immediately.
 *
 * Looked up FRESH here rather than trusting values threaded through from the
 * caller: the owner's name and the list of workspaces they own can change
 * between requests, and this only ever runs right after the DB write commits.
 */
const notifyOwnerOfPlanChange = async (email, oldPlan, newPlan, periodEnd) => {
  try {
    const [owned] = await pool.query(
      `SELECT MAX(u.full_name) AS owner_name,
              GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR '|||') AS names
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id AND t.is_active = 1
        WHERE u.email = ? AND u.role = 'owner' AND u.is_active = 1`,
      [email]
    );
    const row = owned[0];
    // No active owned workspace to describe (e.g. race with a delete) — skip
    // rather than send a confusing "changed the plan on your account" email
    // with nothing to point at.
    if (!row || !row.names) return;

    const rank = (p) => PLAN_RANK[p] ?? 0;
    const direction =
      rank(newPlan) > rank(oldPlan)
        ? "upgraded"
        : rank(newPlan) < rank(oldPlan)
          ? "downgraded"
          : "changed";

    const mail = planChangedEmail({
      ownerName: row.owner_name,
      oldPlanLabel: PLAN_CONFIG[oldPlan]?.label || oldPlan,
      newPlanLabel: PLAN_CONFIG[newPlan]?.label || newPlan,
      direction,
      workspaceNames: row.names.split("|||"),
      lifetime: newPlan !== "free" && !periodEnd,
      expiresAt: periodEnd
        ? periodEnd.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : undefined,
    });

    await sendEmail({ to: email, from: MAIL_FROM_SUPPORT, ...mail });
  } catch (error) {
    // Notification failure must never surface as a plan-change failure.
    console.error("notifyOwnerOfPlanChange failed (non-fatal):", error.message);
  }
};

/**
 * List billing ACCOUNTS (subscriptions are per account, not per workspace). An
 * account is an email that OWNS ≥1 active workspace; its plan is `billing_accounts`
 * (free if none), and it covers every workspace it owns.
 */
const listAccounts = async (search, lg) => {
  try {
    const like = `%${(search || "").trim()}%`;
    const hasSearch = (search || "").trim().length > 0;
    const [rows] = await pool.query(
      `SELECT u.email,
              MAX(u.full_name) AS name,
              COUNT(DISTINCT t.id) AS owned_count,
              GROUP_CONCAT(DISTINCT t.subdomain ORDER BY t.subdomain SEPARATOR ', ') AS workspaces,
              COALESCE(ba.plan_name, 'free') AS plan_name,
              ba.subscription_status,
              ba.billing_interval,
              ba.current_period_end,
              MAX(u.is_platform_admin) AS is_platform_admin
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id AND t.is_active = 1
         LEFT JOIN billing_accounts ba ON ba.email = u.email
        WHERE u.role = 'owner' AND u.is_active = 1
          ${hasSearch ? "AND (u.email LIKE ? OR u.full_name LIKE ?)" : ""}
        GROUP BY u.email, ba.plan_name, ba.subscription_status, ba.billing_interval, ba.current_period_end
        ORDER BY owned_count DESC, u.email ASC`,
      hasSearch ? [like, like] : []
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { rows })
    );
  } catch (error) {
    console.error("admin listAccounts error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/**
 * Admin plan grant/revoke at the ACCOUNT level. Comps a paid plan (no Stripe) or
 * reverts to free, mirroring onto every workspace the account owns. `durationMonths`
 * falsy/0 = lifetime, a positive integer = expires after that many months. Any live
 * Stripe subscription on the account is cancelled first (so the override replaces
 * it and the customer stops being charged).
 */
const setAccountPlanAdmin = async (email, plan, durationMonths, lg) => {
  if (!email) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg));
  }
  if (!PLANS.includes(plan)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg));
  }
  const months = Number(durationMonths);
  const timed = Number.isInteger(months) && months > 0;
  try {
    // Read the PRE-CHANGE plan so the notification email can say "Free →
    // Business" rather than just the destination — fetched before any write,
    // not derived from what the admin UI happened to send.
    const before = await getAccount(email);
    const oldPlan = before?.plan_name || "free";

    // Cancel any live subscription on the active provider first (Stripe/Paddle).
    await cancelActiveSubscription(email);

    let periodEnd = null;
    if (plan === "free") {
      await resetAccountToFree(email, null);
    } else {
      if (timed) {
        periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + months);
      }
      await setAccountPlan(email, {
        plan_name: plan,
        subscription_status: "comped",
        billing_interval: null,
        stripe_subscription_id: null,
        paddle_subscription_id: null,
        current_period_end: periodEnd,
        pending_plan: null,
        pending_interval: null,
        pending_effective_at: null,
      });
    }

    // Fire-and-forget, and only when the plan actually moved — re-selecting the
    // same plan (e.g. re-confirming a duration) shouldn't spam the owner. Not
    // awaited: see notifyOwnerOfPlanChange's own doc comment for why.
    if (oldPlan !== plan) {
      notifyOwnerOfPlanChange(email, oldPlan, plan, periodEnd).catch(() => {});
    }

    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "plan_updated", lg));
  } catch (error) {
    console.error("admin setAccountPlan error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { listAccounts, setAccountPlanAdmin };
