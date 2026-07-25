const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { stripe, isStripeConfigured } = require("../../common/stripe");
const { PLANS, priceIdFor, PLAN_RANK } = require("../../consts/plans");
const { reconcileTenantSubscription } = require("./applySubscription");

const BILLING_ROLES = ["owner"];

/**
 * In-app plan changes with EXPLICIT proration (so behavior is deterministic and
 * identical for monthly + yearly — not left to the Stripe Portal's config):
 *   - UPGRADE (higher tier, or same tier month→year): charge only the prorated
 *     DIFFERENCE now (already-paid time is credited). Previewed before applying.
 *   - DOWNGRADE (lower tier, or same tier year→month): scheduled at period end
 *     via a Stripe Subscription Schedule — keep the higher tier until then, no
 *     refund/credit.
 */

const rank = (plan) => PLAN_RANK[plan] ?? 0;

/** 'upgrade' | 'downgrade' | 'same' for a plan+interval change. */
const directionOf = (curPlan, curInterval, newPlan, newInterval) => {
  if (curPlan === newPlan && curInterval === newInterval) return "same";
  if (rank(newPlan) > rank(curPlan)) return "upgrade";
  if (rank(newPlan) < rank(curPlan)) return "downgrade";
  // same tier, interval differs: to yearly = prepay (upgrade), to monthly = down.
  return newInterval === "year" ? "upgrade" : "downgrade";
};

/** Shared guards + loading. Resolves { tenant, sub, itemId, curPriceId, ... } or rejects. */
const loadForChange = async (plan, interval, authData) => {
  const { tenantId, role, lg } = authData;
  const billingInterval = interval === "year" ? "year" : "month";

  if (!BILLING_ROLES.includes(role)) {
    throw setServerResponse(API_STATUS_CODE.FORBIDDEN, "billing_forbidden", lg);
  }
  if (!isStripeConfigured()) {
    throw setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "stripe_not_configured", lg);
  }
  const newPriceId = priceIdFor(plan, billingInterval);
  if (!PLANS[plan] || plan === "free" || !newPriceId) {
    throw setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg);
  }

  const [rows] = await pool.query(
    "SELECT stripe_customer_id, stripe_subscription_id, plan_name, billing_interval, subscription_status FROM tenants WHERE id = ?",
    [tenantId]
  );
  const t = rows[0];
  // Only tenants with a LIVE Stripe subscription change here; free/comped tenants
  // start a fresh Checkout instead (no existing amount to prorate against).
  if (!t || !t.stripe_subscription_id || t.subscription_status === "comped") {
    throw setServerResponse(API_STATUS_CODE.BAD_REQUEST, "no_active_subscription", lg);
  }

  const sub = await stripe.subscriptions.retrieve(t.stripe_subscription_id);
  const item = sub.items?.data?.[0];
  if (!item) {
    throw setServerResponse(API_STATUS_CODE.BAD_REQUEST, "no_active_subscription", lg);
  }

  const curPlan = t.plan_name || "free";
  const curInterval = t.billing_interval || "month";
  const direction = directionOf(curPlan, curInterval, plan, billingInterval);
  if (direction === "same") {
    throw setServerResponse(API_STATUS_CODE.BAD_REQUEST, "already_on_plan", lg);
  }

  return {
    tenantId,
    lg,
    customerId: t.stripe_customer_id,
    sub,
    itemId: item.id,
    curPriceId: item.price.id,
    newPriceId,
    plan,
    interval: billingInterval,
    direction,
  };
};

/** Preview a change WITHOUT applying it (exact prorated charge for upgrades). */
const previewPlanChange = async (plan, interval, authData) => {
  try {
    const c = await loadForChange(plan, interval, authData);

    if (c.direction === "downgrade") {
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "plan_change_previewed", c.lg, {
          direction: "downgrade",
          amountDueNow: 0,
          currency: (c.sub.currency || "usd").toUpperCase(),
          effectiveAt: c.sub.current_period_end
            ? new Date(c.sub.current_period_end * 1000).toISOString()
            : null,
          immediate: false,
        })
      );
    }

    // Upgrade: preview the exact invoice Stripe will raise now with the same
    // proration behavior we apply. `amount_due` is the true charge — for a plain
    // tier change it's just the prorated difference; for an interval change
    // (month→year) the cycle resets, so it's the new period minus unused credit.
    const preview = await stripe.invoices.createPreview({
      customer: c.customerId,
      subscription: c.sub.id,
      subscription_details: {
        items: [{ id: c.itemId, price: c.newPriceId }],
        proration_behavior: "always_invoice",
      },
    });
    const amountDueNow = preview.amount_due;

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "plan_change_previewed", c.lg, {
        direction: "upgrade",
        amountDueNow: Math.max(0, amountDueNow),
        currency: (preview.currency || "usd").toUpperCase(),
        immediate: true,
      })
    );
  } catch (error) {
    if (error?.statusCode) return Promise.reject(error);
    console.error("previewPlanChange error:", error.message);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", authData.lg)
    );
  }
};

const scheduleIdOf = (sub) =>
  typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id || null;

const clearPending = (tenantId) =>
  pool.query(
    "UPDATE tenants SET pending_plan = NULL, pending_interval = NULL, pending_effective_at = NULL WHERE id = ?",
    [tenantId]
  );

/** Apply a change: upgrade immediately (prorated), downgrade at period end. */
const applyPlanChange = async (plan, interval, authData) => {
  let c;
  try {
    c = await loadForChange(plan, interval, authData);
  } catch (error) {
    if (error?.statusCode) return Promise.reject(error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", authData.lg)
    );
  }

  try {
    if (c.direction === "upgrade") {
      // Cancel any scheduled (pending) downgrade first — the upgrade supersedes it.
      const existingSchedule = scheduleIdOf(c.sub);
      if (existingSchedule) {
        await stripe.subscriptionSchedules.release(existingSchedule).catch(() => {});
      }
      // Swap the price and invoice the prorated difference immediately. A failed
      // card errors out (error_if_incomplete) rather than half-applying.
      await stripe.subscriptions.update(c.sub.id, {
        items: [{ id: c.itemId, price: c.newPriceId }],
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
      });
      await clearPending(c.tenantId);
      await reconcileTenantSubscription(c.tenantId);
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "plan_changed", c.lg, {
          direction: "upgrade",
          plan: c.plan,
          interval: c.interval,
        })
      );
    }

    // Downgrade → schedule at period end (keep current plan until then).
    let scheduleId = scheduleIdOf(c.sub);
    if (!scheduleId) {
      const created = await stripe.subscriptionSchedules.create({ from_subscription: c.sub.id });
      scheduleId = created.id;
    }
    const sched = await stripe.subscriptionSchedules.retrieve(scheduleId);
    const cur = sched.phases[sched.phases.length - 1];
    await stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        {
          items: [{ price: c.curPriceId, quantity: 1 }],
          start_date: cur.start_date,
          end_date: c.sub.current_period_end,
        },
        { items: [{ price: c.newPriceId, quantity: 1 }] },
      ],
    });

    const effectiveAt = c.sub.current_period_end
      ? new Date(c.sub.current_period_end * 1000)
      : null;
    await pool.query(
      "UPDATE tenants SET pending_plan = ?, pending_interval = ?, pending_effective_at = ? WHERE id = ?",
      [c.plan, c.interval, effectiveAt, c.tenantId]
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "plan_change_scheduled", c.lg, {
        direction: "downgrade",
        plan: c.plan,
        interval: c.interval,
        effectiveAt: effectiveAt ? effectiveAt.toISOString() : null,
      })
    );
  } catch (error) {
    if (error?.statusCode) return Promise.reject(error);
    console.error("applyPlanChange error:", error.message);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", c.lg)
    );
  }
};

/** Cancel a scheduled (pending) downgrade — release the schedule, keep current plan. */
const cancelScheduledChange = async (authData) => {
  const { tenantId, role, lg } = authData;
  if (!BILLING_ROLES.includes(role)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, "billing_forbidden", lg));
  }
  if (!isStripeConfigured()) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "stripe_not_configured", lg)
    );
  }
  try {
    const [rows] = await pool.query(
      "SELECT stripe_subscription_id FROM tenants WHERE id = ?",
      [tenantId]
    );
    const subId = rows[0]?.stripe_subscription_id;
    if (subId) {
      const sub = await stripe.subscriptions.retrieve(subId);
      const scheduleId = scheduleIdOf(sub);
      if (scheduleId) await stripe.subscriptionSchedules.release(scheduleId).catch(() => {});
    }
    await clearPending(tenantId);
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "plan_change_cancelled", lg, { ok: true })
    );
  } catch (error) {
    console.error("cancelScheduledChange error:", error.message);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "plan_change_failed", lg)
    );
  }
};

module.exports = { previewPlanChange, applyPlanChange, cancelScheduledChange };
