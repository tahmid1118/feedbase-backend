const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { stripe, isStripeConfigured } = require("../../common/stripe");
const { getAccount, setAccountPlan } = require("../../common/accountBilling");

const BILLING_ROLES = ["owner"];

const scheduleIdOf = (sub) =>
  typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id || null;

/**
 * Load + guard the caller's ACCOUNT subscription for cancel/resume. Owner-only,
 * Stripe-configured, and the account must have a LIVE Stripe subscription (a
 * comped/free account has nothing to cancel).
 */
const loadSub = async (authData) => {
  const { email, role, lg } = authData;
  if (!BILLING_ROLES.includes(role)) {
    throw setServerResponse(API_STATUS_CODE.FORBIDDEN, "billing_forbidden", lg);
  }
  if (!isStripeConfigured()) {
    throw setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "stripe_not_configured", lg);
  }
  const acct = await getAccount(email);
  if (!acct?.stripe_subscription_id || acct.subscription_status === "comped") {
    throw setServerResponse(API_STATUS_CODE.BAD_REQUEST, "no_active_subscription", lg);
  }
  return { email, lg, subId: acct.stripe_subscription_id };
};

/**
 * Cancel the subscription at PERIOD END: the customer keeps their paid plan until
 * `current_period_end` and is NOT charged again; after that Stripe cancels it and
 * the account reverts to Free (via the webhook / reconcile). Any pending downgrade
 * schedule is released first so the flag can be set. Returns `cancelAtPeriodEnd`.
 */
const cancelSubscription = async (authData) => {
  let ctx;
  try {
    ctx = await loadSub(authData);
  } catch (e) {
    if (e?.statusCode) return Promise.reject(e);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", authData.lg));
  }
  try {
    const sub = await stripe.subscriptions.retrieve(ctx.subId);
    // A scheduled (pending) plan change owns the subscription — release it first,
    // otherwise cancel_at_period_end can't be set. Also clears our pending_* note.
    const scheduleId = scheduleIdOf(sub);
    if (scheduleId) {
      await stripe.subscriptionSchedules.release(scheduleId).catch(() => {});
      await setAccountPlan(ctx.email, {
        pending_plan: null,
        pending_interval: null,
        pending_effective_at: null,
      });
    }
    const updated = await stripe.subscriptions.update(ctx.subId, {
      cancel_at_period_end: true,
    });
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "subscription_cancelled", ctx.lg, {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: updated.current_period_end
          ? new Date(updated.current_period_end * 1000).toISOString()
          : null,
      })
    );
  } catch (error) {
    console.error("cancelSubscription error:", error.message);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", ctx.lg)
    );
  }
};

/** Undo a period-end cancellation — the subscription renews normally again. */
const resumeSubscription = async (authData) => {
  let ctx;
  try {
    ctx = await loadSub(authData);
  } catch (e) {
    if (e?.statusCode) return Promise.reject(e);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", authData.lg));
  }
  try {
    await stripe.subscriptions.update(ctx.subId, { cancel_at_period_end: false });
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "subscription_resumed", ctx.lg, {
        cancelAtPeriodEnd: false,
      })
    );
  } catch (error) {
    console.error("resumeSubscription error:", error.message);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", ctx.lg)
    );
  }
};

module.exports = { cancelSubscription, resumeSubscription };
