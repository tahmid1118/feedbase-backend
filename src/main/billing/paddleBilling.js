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
const { getActiveOfferForPlanInterval } = require("../../common/offers");

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

  // Scheduled (pending) downgrade in flight: the Paddle item was already switched to
  // the lower plan (with do_not_bill, so billing continues on the current period and
  // the next renewal auto-bills the lower price), but the customer keeps their
  // current (higher) plan in-app until the paid period ends. Until then, DON'T mirror
  // Paddle's lower plan onto the account — only refresh status/period/ids and keep
  // the pending markers. Once the effective date passes, fall through and apply it.
  const pendingActive =
    acct?.pending_plan &&
    acct?.pending_effective_at &&
    new Date(acct.pending_effective_at) > new Date();
  if (pendingActive) {
    await setAccountPlan(email, {
      subscription_status: sub.status,
      current_period_end: acct.current_period_end || sub.currentPeriodEnd,
      paddle_subscription_id: sub.subscriptionId,
      paddle_customer_id: sub.customerId,
    });
    return;
  }

  await setAccountPlan(email, {
    plan_name: sub.planName,
    subscription_status: sub.status,
    billing_interval: sub.interval,
    current_period_end: sub.currentPeriodEnd,
    paddle_subscription_id: sub.subscriptionId,
    paddle_customer_id: sub.customerId,
    // A scheduled downgrade has now taken effect (Paddle already shows the lower
    // plan) — clear the pending markers.
    pending_plan: null,
    pending_interval: null,
    pending_effective_at: null,
  });
};

/**
 * Create a Paddle transaction for checkout; the client opens it as an overlay.
 * A discount is auto-applied by id on the transaction (never a code typed into the
 * overlay): a **redeemed promo code** (`promotionCode` = its `paddle_discount_id`,
 * re-checked here against the code's plan restriction) takes precedence, else an
 * **active offer** for this plan+interval. So the buyer is charged the discounted
 * price exactly, matching what the Billing tab / pricing page advertise.
 */
const createCheckout = async (plan, authData, promotionCode, interval) => {
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

  // Resolve the discount to apply (by id). A promo code's plan restriction is
  // enforced HERE too — the client sends the discount id, so the server is the only
  // trustworthy place to reject a code scoped to a different plan.
  let discountId = null;
  if (promotionCode) {
    const [[promoRow]] = await pool.query(
      "SELECT applies_to_plan FROM promo_codes WHERE paddle_discount_id = ? AND is_active = 1 LIMIT 1",
      [promotionCode]
    );
    if (
      promoRow &&
      promoRow.applies_to_plan &&
      promoRow.applies_to_plan !== "any" &&
      promoRow.applies_to_plan !== plan
    ) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "promo_plan_mismatch", lg));
    }
    discountId = promotionCode;
  } else {
    const offer = await getActiveOfferForPlanInterval(plan, billingInterval);
    if (offer?.paddleDiscountId) discountId = offer.paddleDiscountId;
  }

  try {
    const customerId = await ensurePaddleCustomer(email);
    const txn = await paddle.transactions.create({
      items: [{ priceId, quantity: 1 }],
      customerId,
      customData: { accountEmail: email, plan, interval: billingInterval },
      ...(discountId ? { discountId } : {}),
    });
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "checkout_session_created", lg, {
        provider: "paddle",
        transactionId: txn.id,
      })
    );
  } catch (error) {
    console.error("paddle createCheckout error:", error.message);
    /**
     * A discount can be big enough that the remaining charge falls under the
     * processor's minimum (Paddle: $0.70 on USD — so 99% off a $10 plan leaves
     * $0.10 and the transaction is refused). That's a configuration problem the
     * admin can fix, not a server fault, so say what's wrong instead of showing
     * "Failed to start checkout". A near-total discount should be a free_plan
     * comp code, which grants the plan without charging at all.
     */
    if (/minimum payment amount|balance is less than/i.test(error.message || "")) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "discount_below_minimum", lg)
      );
    }
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_create_checkout", lg)
    );
  }
};

/**
 * The discount to attach when moving a subscription to (plan, interval).
 *
 * Checkout applies the active offer, but a plan CHANGE used to send only the new
 * price — so a customer who was shown "Pro yearly $4.48/mo" on the card was quoted
 * and charged the $96 list price instead of the $53.76 offer. Advertising one
 * price and charging another is the same defect we fixed on the pricing cards,
 * just on a different code path.
 *
 * Our offer discounts are `restrictTo` a single price, so the discount that was on
 * the old plan cannot apply to the new one; the target plan's own offer has to be
 * attached explicitly.
 */
const offerDiscountFor = async (plan, interval) => {
  const offer = await getActiveOfferForPlanInterval(plan, interval);
  return offer?.paddleDiscountId || null;
};

/** Paddle's `discount` field for a subscription update, or {} when there's none. */
const discountPatch = (discountId) =>
  discountId ? { discount: { id: discountId, effectiveFrom: "immediately" } } : {};

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
  return {
    email,
    lg,
    subId: acct.paddle_subscription_id,
    curPlan: acct.plan_name || "free",
    curInterval: acct.billing_interval || "month",
    periodEnd: acct.current_period_end || null,
  };
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
 * DOWNGRADE → takes effect at the END of the current paid period: no charge now,
 * no refund, the customer keeps their current (higher) plan until `periodEnd`, then
 * the lower plan applies. So `amountDueNow` is 0 and `effectiveAt` is the period end.
 * (We do NOT call Paddle's preview for a downgrade — `prorated_next_billing_period`
 * rejects interval changes outright, and there's no charge to preview anyway.)
 */
const previewChange = async (plan, interval, authData) => {
  try {
    const c = await loadForChange(authData);
    const billingInterval = interval === "year" ? "year" : "month";
    const direction = directionOf(c.curPlan, c.curInterval, plan, billingInterval);
    if (direction === "same") {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "already_on_plan", c.lg));
    }
    if (direction === "downgrade") {
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "plan_change_previewed", c.lg, {
          direction,
          amountDueNow: 0,
          currency: "USD",
          effectiveAt: c.periodEnd || null,
          immediate: false,
        })
      );
    }
    // Upgrade — charged now, prorated. Preview the exact tax-inclusive figure.
    const priceId = paddlePriceIdFor(plan, billingInterval);
    const preview = await paddle.subscriptions.previewUpdate(c.subId, {
      items: [{ priceId, quantity: 1 }],
      prorationBillingMode: "prorated_immediately",
      ...discountPatch(await offerDiscountFor(plan, billingInterval)),
    });
    const { amount, currency } = previewAmountDueNow(preview);
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "plan_change_previewed", c.lg, {
        direction,
        amountDueNow: amount,
        currency,
        effectiveAt: null,
        immediate: true,
      })
    );
  } catch (error) {
    if (error?.statusCode) return Promise.reject(error);
    console.error("paddle previewChange error:", error.message);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", authData.lg));
  }
};

/**
 * Apply a change.
 *  - UPGRADE → `prorated_immediately` (charges the prorated diff now; `on_payment_
 *    failure` defaults to `prevent_change`, so the plan only switches if the charge
 *    succeeds). Takes effect immediately.
 *  - DOWNGRADE (same billing interval) → the customer keeps their current (higher)
 *    plan until the END of the paid period, then the lower plan applies — no charge,
 *    no refund. Paddle has no scheduled plan change, so we switch the Paddle item
 *    now with `do_not_bill` (verified: no charge/refund, billing date preserved, so
 *    the next renewal auto-bills the lower price) but keep the account's in-app plan
 *    at the current tier until `periodEnd` via the pending_* markers. `reconcile`
 *    holds the higher plan until the effective date, then flips to the lower one.
 *  - DOWNGRADE that also shortens the interval (yearly → monthly) → **deferred**:
 *    Paddle can't preserve a paid year across an interval change (do_not_bill resets
 *    the period; pinning next_billed_at is ignored) and has no scheduled plan change,
 *    so we leave the Paddle item on the YEARLY price and only record the pending_*
 *    markers. `applyDuePendingChanges` (run by the billing scheduler) performs the
 *    swap near the period end with `prorated_immediately`, which charges the first
 *    month and credits the unused sliver of the year — the customer keeps the full
 *    year they paid for and is never billed another one.
 *  - A downgrade that LENGTHENS the interval (monthly → yearly) is not offered:
 *    change the tier first, then the interval.
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
  // A downgrade that LENGTHENS the interval (monthly → yearly) isn't offered — do
  // the tier change first, then switch interval. Everything else is supported.
  const intervalChanged = billingInterval !== c.curInterval;
  if (direction === "downgrade" && intervalChanged && c.curInterval === "month") {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "downgrade_interval_unsupported", c.lg)
    );
  }
  try {
    const priceId = paddlePriceIdFor(plan, billingInterval);
    if (direction === "upgrade") {
      await paddle.subscriptions.update(c.subId, {
        items: [{ priceId, quantity: 1 }],
        prorationBillingMode: "prorated_immediately",
        ...discountPatch(await offerDiscountFor(plan, billingInterval)),
      });
      await reconcile(c.email);
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "plan_changed", c.lg, { direction, plan, interval: billingInterval })
      );
    }
    // DOWNGRADE — the customer keeps their current plan until the paid period ends.
    //  · Same interval: swap the Paddle item NOW with `do_not_bill` (no charge/
    //    refund, billing date preserved), so the next renewal auto-bills the lower
    //    price. The in-app plan is held at the higher tier by the pending_* markers.
    //  · Interval change (yearly → monthly): do NOT touch Paddle — swapping now
    //    would reset the billing period and destroy the paid year. The scheduler
    //    (`applyDuePendingChanges`) performs the swap near the period end instead.
    if (!intervalChanged) {
      await paddle.subscriptions.update(c.subId, {
        items: [{ priceId, quantity: 1 }],
        prorationBillingMode: "do_not_bill",
        ...discountPatch(await offerDiscountFor(plan, billingInterval)),
      });
    }
    await setAccountPlan(c.email, {
      pending_plan: plan,
      pending_interval: billingInterval,
      pending_effective_at: c.periodEnd,
    });
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "plan_change_scheduled", c.lg, {
        direction,
        plan,
        interval: billingInterval,
        effectiveAt: c.periodEnd || null,
      })
    );
  } catch (error) {
    console.error("paddle applyChange error:", error.message);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", c.lg));
  }
};

/**
 * Cancel a scheduled (pending) downgrade before it takes effect: switch the Paddle
 * item back to the current in-app (higher) plan with `do_not_bill` and clear the
 * pending markers. No-op if there's no pending change.
 */
const cancelScheduledChange = async (authData) => {
  let c;
  try {
    c = await loadForChange(authData);
  } catch (error) {
    if (error?.statusCode) return Promise.reject(error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", authData.lg));
  }
  const acct = await getAccount(c.email);
  if (!acct?.pending_plan) {
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "plan_change_cancelled", c.lg, { ok: true }));
  }
  try {
    const priceId = paddlePriceIdFor(c.curPlan, c.curInterval);
    // Only touch Paddle if its item actually differs from the plan we're restoring.
    // A *deferred* (yearly→monthly) pending change never swapped the Paddle item, so
    // re-sending the same price would be a pointless update that RESETS the billing
    // period — silently shortening a paid year.
    const sub = await paddle.subscriptions.get(c.subId);
    const livePriceId = sub.items?.[0]?.price?.id || null;
    if (priceId && livePriceId !== priceId) {
      await paddle.subscriptions.update(c.subId, {
        items: [{ priceId, quantity: 1 }],
        prorationBillingMode: "do_not_bill",
      });
    }
    await setAccountPlan(c.email, {
      pending_plan: null,
      pending_interval: null,
      pending_effective_at: null,
    });
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "plan_change_cancelled", c.lg, { ok: true }));
  } catch (error) {
    console.error("paddle cancelScheduledChange error:", error.message);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", c.lg));
  }
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

/**
 * Apply scheduled plan changes that are due — the piece Paddle can't do natively.
 * Run periodically by the billing scheduler (see `src/common/billingScheduler.js`).
 *
 * Only accounts whose Paddle item still DIFFERS from the pending target need work:
 *  · A same-interval downgrade already swapped its item at request time (the item
 *    matches the target), so it's skipped here — its renewal bills the lower price
 *    on its own and `reconcile` flips the in-app plan once the date passes.
 *  · A **yearly → monthly** downgrade deliberately left the Paddle item on the
 *    yearly price so the paid year survived. That's what we apply here.
 *
 * Proration is chosen so nobody is over- or under-charged:
 *  · interval unchanged → `do_not_bill` (no charge; the renewal bills the new price)
 *  · interval changed   → `prorated_immediately`, which charges the first month of
 *    the new plan and CREDITS the unused remainder of the year. Running slightly
 *    early is therefore financially fair rather than a loss to either side — using
 *    `do_not_bill` here would instead hand the customer a free month.
 *
 * `leadSeconds` makes the change eligible shortly BEFORE the renewal instant, so a
 * missed tick doesn't let Paddle bill another full year first.
 */
const applyDuePendingChanges = async ({ leadSeconds = 6 * 3600 } = {}) => {
  if (!isPaddleConfigured()) return { checked: 0, applied: 0 };
  const [rows] = await pool.query(
    `SELECT email, plan_name, billing_interval, pending_plan, pending_interval,
            pending_effective_at, paddle_subscription_id
       FROM billing_accounts
      WHERE pending_plan IS NOT NULL
        AND pending_effective_at IS NOT NULL
        AND paddle_subscription_id IS NOT NULL
        AND (subscription_status IS NULL OR subscription_status <> 'comped')
        AND pending_effective_at <= DATE_ADD(NOW(), INTERVAL ? SECOND)`,
    [leadSeconds]
  );

  let applied = 0;
  for (const row of rows) {
    try {
      const targetInterval = row.pending_interval === "year" ? "year" : "month";
      const targetPriceId = paddlePriceIdFor(row.pending_plan, targetInterval);
      if (!targetPriceId) continue;

      const sub = await paddle.subscriptions.get(row.paddle_subscription_id);
      const livePriceId = sub.items?.[0]?.price?.id || null;
      if (livePriceId === targetPriceId) continue; // already switched — nothing to do

      // Safety net: if the renewal beat us (the period now ends well after the date
      // we were aiming at), the customer has already been billed for another term.
      // Re-target the change at the NEW period end rather than applying it now and
      // charging them twice — and shout, because a tick was missed.
      const periodEnd = sub.currentBillingPeriod?.endsAt
        ? new Date(sub.currentBillingPeriod.endsAt)
        : null;
      const due = new Date(row.pending_effective_at);
      if (periodEnd && periodEnd.getTime() - due.getTime() > 24 * 3600 * 1000) {
        console.error(
          `billing scheduler: MISSED the change window for ${row.email} — subscription renewed on the old plan. Re-targeting to ${periodEnd.toISOString()}.`
        );
        await setAccountPlan(row.email, { pending_effective_at: periodEnd });
        continue;
      }

      const liveInterval = intervalByPaddlePriceId(livePriceId);
      const prorationBillingMode =
        liveInterval === targetInterval ? "do_not_bill" : "prorated_immediately";
      await paddle.subscriptions.update(row.paddle_subscription_id, {
        items: [{ priceId: targetPriceId, quantity: 1 }],
        prorationBillingMode,
      });
      await reconcile(row.email);
      applied += 1;
      console.log(
        `billing scheduler: applied ${row.plan_name}/${row.billing_interval} → ${row.pending_plan}/${targetInterval} for ${row.email} (${prorationBillingMode})`
      );
    } catch (e) {
      // One bad account must not stop the sweep; it retries on the next tick.
      console.error(`billing scheduler: failed for ${row.email}:`, e.message);
    }
  }
  return { checked: rows.length, applied };
};

module.exports = {
  reconcile,
  fetchSubscription,
  createCheckout,
  previewChange,
  applyChange,
  applyDuePendingChanges,
  cancelScheduledChange,
  cancelSubscription,
  resumeSubscription,
  createPortalSession,
  cancelLiveSubscription,
  handleWebhook,
};
