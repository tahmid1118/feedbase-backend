const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { getPlanLimits } = require("../../consts/plans");
const { reconcileAccount } = require("../../common/accountBilling");
const { getActiveOffers } = require("../../common/offers");
const { stripe, isStripeConfigured } = require("../../common/stripe");

/**
 * @description Return the caller's ACCOUNT subscription state for the Billing tab.
 * The subscription is per account (email) and covers every workspace the account
 * owns; this reads billing_accounts, not the tenant.
 * @param {object} authData { email, lg }
 */
const getBillingStatus = async (authData) => {
  const { email, lg } = authData;
  try {
    // Reconcile from Stripe first so the plan reflects a just-completed checkout
    // or cancellation even when webhooks aren't delivered (e.g. local dev). A
    // Stripe failure here is non-fatal — we fall back to the stored values.
    try {
      await reconcileAccount(email);
    } catch (reconcileErr) {
      console.error("Billing reconcile failed (non-fatal):", reconcileErr.message);
    }

    const [rows] = await pool.query(
      `SELECT plan_name, subscription_status, billing_interval, current_period_end,
              stripe_subscription_id, pending_plan, pending_interval, pending_effective_at
       FROM billing_accounts WHERE email = ?`,
      [email]
    );
    // No billing_accounts row yet ⇒ a free account (never subscribed).
    const t = rows[0] || { plan_name: "free" };
    const planName = t.plan_name || "free";

    // Whether a live Stripe subscription is set to cancel at period end. Lets the
    // UI say the plan "ends on" current_period_end (no further charge) instead of
    // "renews on" it. Read live from Stripe; non-fatal, defaults to false.
    let cancelAtPeriodEnd = false;
    if (isStripeConfigured() && t.stripe_subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(t.stripe_subscription_id);
        cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
      } catch (subErr) {
        console.error("Fetch subscription cancel state failed (non-fatal):", subErr.message);
      }
    }

    const result = {
      planName,
      subscriptionStatus: t.subscription_status || null,
      billingInterval: t.billing_interval || null, // 'month' | 'year' | null
      currentPeriodEnd: t.current_period_end || null,
      hasSubscription: Boolean(t.stripe_subscription_id),
      // True when the active subscription won't renew (set to cancel at period end).
      cancelAtPeriodEnd,
      // A scheduled (period-end) downgrade, if any — for the "changes to X on Y" note.
      pendingPlan: t.pending_plan || null,
      pendingInterval: t.pending_interval || null,
      pendingEffectiveAt: t.pending_effective_at || null,
      limits: getPlanLimits(planName),
      // Active promotional offers keyed by plan (for the diagonal-strike price).
      offers: await getActiveOffers(),
    };

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "billing_status_retrieved", lg, result)
    );
  } catch (error) {
    console.error("Error getting billing status:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_get_billing_status",
        lg
      )
    );
  }
};

module.exports = { getBillingStatus };
