/**
 * Paddle (Merchant of Record) billing operations — the active provider when
 * BILLING_PROVIDER=paddle. Exposes the same normalized operations the billing
 * routes need, returning the same setServerResponse shapes as the Stripe handlers
 * so the routes can dispatch to either provider uniformly (see billingProvider.js).
 *
 * Notes on the Paddle model vs Stripe:
 *  - Checkout is a client-side OVERLAY: we create a Paddle transaction here and
 *    return its id; the frontend opens Paddle.js with it. customData.accountEmail
 *    is copied onto the subscription so webhooks/reconcile can attribute it.
 *  - Item changes apply IMMEDIATELY in Paddle (no Stripe-style scheduled phases).
 *    So UPGRADES are in-app + prorated now; DOWNGRADES / interval-downs are routed
 *    to the Paddle customer portal, where Paddle schedules them to renewal.
 *  - Cancel-at-period-end + resume are native (scheduledChange action 'cancel').
 */
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { paddle, isPaddleConfigured } = require("../../common/paddle");
const {
  PLANS,
  PLAN_RANK,
  paddlePriceIdFor,
  planByPaddlePriceId,
  intervalByPaddlePriceId,
} = require("../../consts/plans");
const {
  getAccount,
  setAccountPlan,
  resetAccountToFree,
} = require("../../common/accountBilling");

const BILLING_ROLES = ["owner"];
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const rank = (plan) => PLAN_RANK[plan] ?? 0;

/** 'upgrade' | 'downgrade' | 'same' — same rule as the Stripe path. */
const directionOf = (curPlan, curInterval, newPlan, newInterval) => {
  if (curPlan === newPlan && curInterval === newInterval) return "same";
  if (rank(newPlan) > rank(curPlan)) return "upgrade";
  if (rank(newPlan) < rank(curPlan)) return "downgrade";
  return newInterval === "year" ? "upgrade" : "downgrade";
};

/** Collect a Paddle list Collection into an array. */
const collect = async (collection) => {
  const out = [];
  for await (const item of collection) out.push(item);
  return out;
};

/** Normalize a Paddle Subscription into our provider-agnostic shape. */
const normalizeSub = (sub) => {
  const isActive = ["active", "trialing", "past_due"].includes(sub.status);
  const priceId = sub.items?.[0]?.price?.id || null;
  return {
    subscriptionId: sub.id,
    customerId: sub.customerId,
    status: sub.status,
    planName: isActive ? planByPaddlePriceId(priceId) || "free" : "free",
    interval: isActive ? intervalByPaddlePriceId(priceId) : null,
    currentPeriodEnd: sub.currentBillingPeriod?.endsAt
      ? new Date(sub.currentBillingPeriod.endsAt)
      : null,
    cancelAtPeriodEnd: sub.scheduledChange?.action === "cancel",
  };
};

/** Get-or-create the account's Paddle customer id (stored on billing_accounts). */
const ensurePaddleCustomer = async (email) => {
  const acct = await getAccount(email);
  if (acct?.paddle_customer_id) return acct.paddle_customer_id;

  // Reuse an existing Paddle customer for this email if one exists (create throws
  // on a duplicate email).
  const existing = await collect(paddle.customers.list({ email: [email] }));
  const customer = existing[0] || (await paddle.customers.create({ email }));
  await setAccountPlan(email, { paddle_customer_id: customer.id });
  return customer.id;
};

/**
 * Find the account's live Paddle subscription (by stored id, else by customer),
 * normalized — or null. Persists the discovered subscription id.
 */
const fetchSubscription = async (email) => {
  const acct = await getAccount(email);
  if (acct?.paddle_subscription_id) {
    const sub = await paddle.subscriptions.get(acct.paddle_subscription_id);
    return normalizeSub(sub);
  }
  // Resolve the Paddle customer id (stored, else look it up by email) so we can
  // find a subscription created via a checkout whose customer id wasn't persisted.
  let customerId = acct?.paddle_customer_id || null;
  if (!customerId) {
    const found = await collect(paddle.customers.list({ email: [email] }));
    customerId = found[0]?.id || null;
    if (customerId) await setAccountPlan(email, { paddle_customer_id: customerId });
  }
  if (customerId) {
    const subs = await collect(
      paddle.subscriptions.list({ customerId: [customerId], status: ["active", "trialing", "past_due"] })
    );
    if (subs[0]) {
      await setAccountPlan(email, { paddle_subscription_id: subs[0].id });
      return normalizeSub(subs[0]);
    }
  }
  return null;
};

/**
 * Reconcile the account from Paddle (the no-webhook fallback + post-checkout sync).
 * Preserves comped accounts; writes the normalized subscription otherwise.
 */
const reconcile = async (email) => {
  if (!email || !isPaddleConfigured()) return;
  const acct = await getAccount(email);
  if (acct?.subscription_status === "comped") {
    const end = acct.current_period_end;
    if (end && new Date(end) < new Date()) await resetAccountToFree(email, null);
    return;
  }
  const sub = await fetchSubscription(email);
  if (!sub || sub.planName === "free") {
    // No live paid subscription — revert to free (keeps paddle_customer_id).
    if (acct?.subscription_status && acct.subscription_status !== "comped") {
      await resetAccountToFree(email, sub?.status || null);
    }
    return;
  }
  await setAccountPlan(email, {
    plan_name: sub.planName,
    subscription_status: sub.status,
    billing_interval: sub.interval,
    current_period_end: sub.currentPeriodEnd,
    paddle_subscription_id: sub.subscriptionId,
    paddle_customer_id: sub.customerId,
    // Paddle handles scheduled downgrades in its portal, so no pending_* here.
    pending_plan: null,
    pending_interval: null,
    pending_effective_at: null,
  });
};

/** Create a Paddle transaction for checkout; the client opens it as an overlay. */
const createCheckout = async (plan, authData, _promotionCode, interval) => {
  const { role, email, lg } = authData;
  const billingInterval = interval === "year" ? "year" : "month";
  if (!BILLING_ROLES.includes(role)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, "billing_forbidden", lg));
  }
  if (!isPaddleConfigured()) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "stripe_not_configured", lg));
  }
  const priceId = paddlePriceIdFor(plan, billingInterval);
  if (!PLANS[plan] || plan === "free" || !priceId) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg));
  }
  try {
    const customerId = await ensurePaddleCustomer(email);
    const txn = await paddle.transactions.create({
      items: [{ priceId, quantity: 1 }],
      customerId,
      customData: { accountEmail: email, plan, interval: billingInterval },
    });
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "checkout_session_created", lg, {
        provider: "paddle",
        transactionId: txn.id,
      })
    );
  } catch (error) {
    console.error("paddle createCheckout error:", error.message);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_create_checkout", lg)
    );
  }
};

/** Shared guard: owner + Stripe/Paddle configured + a live subscription. */
const loadForChange = async (authData) => {
  const { email, role, lg } = authData;
  if (!BILLING_ROLES.includes(role)) {
    throw setServerResponse(API_STATUS_CODE.FORBIDDEN, "billing_forbidden", lg);
  }
  if (!isPaddleConfigured()) {
    throw setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "stripe_not_configured", lg);
  }
  const acct = await getAccount(email);
  if (!acct?.paddle_subscription_id || acct.subscription_status === "comped") {
    throw setServerResponse(API_STATUS_CODE.BAD_REQUEST, "no_active_subscription", lg);
  }
  return { email, lg, subId: acct.paddle_subscription_id, curPlan: acct.plan_name || "free", curInterval: acct.billing_interval || "month" };
};

/**
 * The exact amount charged TODAY for a subscription update (minor units) + the
 * currency, read from the preview's immediate transaction — the authoritative,
 * tax-inclusive, credit-applied figure (matches what `update` will charge). Falls
 * back to the update-summary net, then 0 (e.g. a downgrade billed next period).
 */
const previewAmountDueNow = (preview) => {
  const totals = preview.immediateTransaction?.details?.totals;
  if (totals?.grandTotal != null) {
    return { amount: Math.max(0, Number(totals.grandTotal)), currency: (totals.currencyCode || "USD").toUpperCase() };
  }
  const r = preview.updateSummary?.result;
  if (r?.action === "charge") {
    return { amount: Math.max(0, Number(r.amount)), currency: (r.currencyCode || "USD").toUpperCase() };
  }
  return { amount: 0, currency: (preview.currencyCode || "USD").toUpperCase() };
};

/**
 * Preview a change. UPGRADE → the exact prorated charge now (prorated_immediately).
 * DOWNGRADE → applied at renewal with `prorated_next_billing_period` (no charge
 * now, unused time credited to the next bill), so `amountDueNow` is 0.
 */
const previewChange = async (plan, interval, authData) => {
  try {
    const c = await loadForChange(authData);
    const billingInterval = interval === "year" ? "year" : "month";
    const direction = directionOf(c.curPlan, c.curInterval, plan, billingInterval);
    if (direction === "same") {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "already_on_plan", c.lg));
    }
    const priceId = paddlePriceIdFor(plan, billingInterval);
    const prorationBillingMode = direction === "upgrade" ? "prorated_immediately" : "prorated_next_billing_period";
    const preview = await paddle.subscriptions.previewUpdate(c.subId, {
      items: [{ priceId, quantity: 1 }],
      prorationBillingMode,
    });
    const { amount, currency } = previewAmountDueNow(preview);
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "plan_change_previewed", c.lg, {
        direction,
        amountDueNow: amount,
        currency,
        // A downgrade takes effect at the next renewal (nextBilledAt); upgrades now.
        effectiveAt: direction === "downgrade" ? preview.nextBilledAt || null : null,
        immediate: direction === "upgrade",
      })
    );
  } catch (error) {
    if (error?.statusCode) return Promise.reject(error);
    console.error("paddle previewChange error:", error.message);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", authData.lg));
  }
};

/**
 * Apply a change. UPGRADE → `prorated_immediately` (charges the prorated diff now;
 * `on_payment_failure` defaults to `prevent_change`, so the plan only switches if
 * the charge succeeds). DOWNGRADE → `prorated_next_billing_period` (switches now,
 * no charge, unused time credited to the next bill — Paddle can't defer an item
 * change to period end, so this is the money-safe in-app pattern).
 */
const applyChange = async (plan, interval, authData) => {
  let c;
  try {
    c = await loadForChange(authData);
  } catch (error) {
    if (error?.statusCode) return Promise.reject(error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", authData.lg));
  }
  const billingInterval = interval === "year" ? "year" : "month";
  const direction = directionOf(c.curPlan, c.curInterval, plan, billingInterval);
  if (direction === "same") {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "already_on_plan", c.lg));
  }
  try {
    const priceId = paddlePriceIdFor(plan, billingInterval);
    await paddle.subscriptions.update(c.subId, {
      items: [{ priceId, quantity: 1 }],
      prorationBillingMode: direction === "upgrade" ? "prorated_immediately" : "prorated_next_billing_period",
    });
    await reconcile(c.email);
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, direction === "upgrade" ? "plan_changed" : "plan_change_scheduled", c.lg, {
        direction,
        plan,
        interval: billingInterval,
      })
    );
  } catch (error) {
    console.error("paddle applyChange error:", error.message);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", c.lg));
  }
};

/** Paddle has no in-app pending schedule (downgrades apply immediately) — no-op ok. */
const cancelScheduledChange = async (authData) => {
  return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "plan_change_cancelled", authData.lg, { ok: true }));
};

/** Cancel at period end (scheduledChange 'cancel'). */
const cancelSubscription = async (authData) => {
  let c;
  try {
    c = await loadForChange(authData);
  } catch (e) {
    if (e?.statusCode) return Promise.reject(e);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", authData.lg));
  }
  try {
    const sub = await paddle.subscriptions.cancel(c.subId, { effectiveFrom: "next_billing_period" });
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "subscription_cancelled", c.lg, {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: sub.scheduledChange?.effectiveAt || sub.currentBillingPeriod?.endsAt || null,
      })
    );
  } catch (error) {
    console.error("paddle cancelSubscription error:", error.message);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", c.lg));
  }
};

/** Resume — clear the scheduled cancellation. */
const resumeSubscription = async (authData) => {
  let c;
  try {
    c = await loadForChange(authData);
  } catch (e) {
    if (e?.statusCode) return Promise.reject(e);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", authData.lg));
  }
  try {
    await paddle.subscriptions.update(c.subId, { scheduledChange: null });
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "subscription_resumed", c.lg, { cancelAtPeriodEnd: false }));
  } catch (error) {
    console.error("paddle resumeSubscription error:", error.message);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", c.lg));
  }
};

/** Paddle customer portal session (manage card, downgrade, cancel). */
const createPortalSession = async (authData) => {
  const { email, role, lg } = authData;
  if (!BILLING_ROLES.includes(role)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, "billing_forbidden", lg));
  }
  if (!isPaddleConfigured()) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "stripe_not_configured", lg));
  }
  try {
    const acct = await getAccount(email);
    if (!acct?.paddle_customer_id) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "no_active_subscription", lg));
    }
    const subIds = acct.paddle_subscription_id ? [acct.paddle_subscription_id] : [];
    const session = await paddle.customerPortalSessions.create(acct.paddle_customer_id, subIds);
    const url = session.urls?.general?.overview || session.urls?.general || null;
    if (!url) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_create_portal", lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "portal_session_created", lg, { url }));
  } catch (error) {
    console.error("paddle createPortalSession error:", error.message);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_create_portal", lg));
  }
};

/** Cancel a live subscription immediately (used before an admin/promo comp). */
const cancelLiveSubscription = async (email) => {
  const acct = await getAccount(email);
  if (!acct?.paddle_subscription_id || !isPaddleConfigured()) return;
  try {
    await paddle.subscriptions.cancel(acct.paddle_subscription_id, { effectiveFrom: "immediately" });
  } catch (error) {
    console.error("paddle cancelLiveSubscription (non-fatal):", error.message);
  }
};

/** Verify + apply a Paddle webhook event. Returns { received: true }. */
const handleWebhook = async (rawBody, signature) => {
  const secret = process.env.PADDLE_WEBHOOK_SECRET || "";
  let event;
  try {
    event = await paddle.webhooks.unmarshal(rawBody, secret, signature);
  } catch (err) {
    const e = new Error(err.message || "Invalid signature");
    e.statusCode = 400;
    throw e;
  }
  try {
    if (event?.eventType && event.eventType.startsWith("subscription.")) {
      const sub = event.data;
      // Attribute the event to an account: the checkout stamps customData.
      // accountEmail (copied onto the subscription); fall back to the owning
      // account by the Paddle subscription/customer id we've stored.
      let email = sub?.customData?.accountEmail || null;
      if (!email && (sub?.id || sub?.customerId)) {
        const [rows] = await pool.query(
          "SELECT email FROM billing_accounts WHERE paddle_subscription_id = ? OR paddle_customer_id = ? LIMIT 1",
          [sub?.id || null, sub?.customerId || null]
        );
        email = rows[0]?.email || null;
      }
      // reconcile() re-reads the live subscription and upserts — naturally
      // idempotent, so at-least-once delivery / retries are safe.
      if (email) await reconcile(email);
    }
  } catch (err) {
    console.error(`Paddle webhook handler error for ${event?.eventType}:`, err.message);
  }
  return { received: true };
};

module.exports = {
  reconcile,
  fetchSubscription,
  createCheckout,
  previewChange,
  applyChange,
  cancelScheduledChange,
  cancelSubscription,
  resumeSubscription,
  createPortalSession,
  cancelLiveSubscription,
  handleWebhook,
};
