const { pool } = require("../../database/dbPool");
const { stripe, isStripeConfigured } = require("./stripe");
const { planByPriceId } = require("../consts/plans");

/**
 * Account-level billing (subscriptions are per ACCOUNT/email, not per workspace).
 *
 * `billing_accounts` (keyed by email) is the source of truth: the Stripe customer/
 * subscription, comp status, interval, period end, and any scheduled change. The
 * account's plan is **mirrored** onto every workspace the account OWNS
 * (`tenants.plan_name` + display columns), so the many existing readers of
 * `tenants.plan_name` (enforcement, portal booleans, getMyTenant, …) keep working
 * unchanged. All writes go through `setAccountPlan` / `mirrorAccountToTenants` so
 * the mirror can't drift.
 */

/** The owner (role='owner') email for a tenant, or null. */
const ownerEmailOfTenant = async (tenantId, conn = pool) => {
  const [rows] = await conn.query(
    "SELECT email FROM users WHERE tenant_id = ? AND role = 'owner' AND is_active = 1 LIMIT 1",
    [tenantId]
  );
  return rows[0]?.email || null;
};

/** billing_accounts row for an email, or a synthesized free default. */
const getAccount = async (email, conn = pool) => {
  if (!email) return { email: null, plan_name: "free" };
  const [rows] = await conn.query(
    "SELECT * FROM billing_accounts WHERE email = ? LIMIT 1",
    [email]
  );
  return rows[0] || { email, plan_name: "free" };
};

/** Get-or-create the billing_accounts row for an email (free by default). */
const ensureAccount = async (email, conn = pool) => {
  if (!email) throw new Error("ensureAccount: email required");
  await conn.query(
    "INSERT IGNORE INTO billing_accounts (email, plan_name) VALUES (?, 'free')",
    [email]
  );
  return getAccount(email, conn);
};

/**
 * Mirror an account's plan/display state onto every ACTIVE tenant it OWNS. The
 * mirrored columns are what enforcement + portal read. Legacy tenant-level Stripe
 * ids are cleared (billing is account-level).
 */
const mirrorAccountToTenants = async (email, conn = pool) => {
  const acct = await getAccount(email, conn);
  await conn.query(
    `UPDATE tenants t
        JOIN users u ON u.tenant_id = t.id AND u.role = 'owner' AND u.is_active = 1
        SET t.plan_name = ?,
            t.subscription_status = ?,
            t.billing_interval = ?,
            t.current_period_end = ?,
            t.pending_plan = ?,
            t.pending_interval = ?,
            t.pending_effective_at = ?,
            t.stripe_customer_id = NULL,
            t.stripe_subscription_id = NULL
      WHERE u.email = ? AND t.is_active = 1`,
    [
      acct.plan_name || "free",
      acct.subscription_status || null,
      acct.billing_interval || null,
      acct.current_period_end || null,
      acct.pending_plan || null,
      acct.pending_interval || null,
      acct.pending_effective_at || null,
      email,
    ]
  );
};

/**
 * Upsert the account's billing fields AND mirror to its owned tenants, atomically.
 * `fields` may include any billing_accounts column; omitted columns are left as-is
 * on an existing row. Pass `reset:true` to clear the Stripe/period columns (used
 * when reverting to free).
 */
const setAccountPlan = async (email, fields = {}, outerConn = null) => {
  if (!email) throw new Error("setAccountPlan: email required");
  const conn = outerConn || (await pool.getConnection());
  const ownTx = !outerConn;
  try {
    if (ownTx) await conn.beginTransaction();
    await conn.query(
      "INSERT IGNORE INTO billing_accounts (email, plan_name) VALUES (?, 'free')",
      [email]
    );

    // Build a dynamic UPDATE from the provided fields.
    const allowed = [
      "plan_name",
      "stripe_customer_id",
      "stripe_subscription_id",
      "subscription_status",
      "billing_interval",
      "current_period_end",
      "pending_plan",
      "pending_interval",
      "pending_effective_at",
    ];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (key in fields) {
        sets.push(`${key} = ?`);
        vals.push(fields[key] === undefined ? null : fields[key]);
      }
    }
    if (sets.length) {
      await conn.query(
        `UPDATE billing_accounts SET ${sets.join(", ")} WHERE email = ?`,
        [...vals, email]
      );
    }
    await mirrorAccountToTenants(email, conn);
    if (ownTx) await conn.commit();
  } catch (e) {
    if (ownTx) await conn.rollback();
    throw e;
  } finally {
    if (ownTx) conn.release();
  }
};

/** Revert an account to Free, clearing subscription/comp state, then mirror. */
const resetAccountToFree = async (email, status = null, outerConn = null) =>
  setAccountPlan(
    email,
    {
      plan_name: "free",
      subscription_status: status,
      billing_interval: null,
      stripe_subscription_id: null,
      current_period_end: null,
      pending_plan: null,
      pending_interval: null,
      pending_effective_at: null,
    },
    outerConn
  );

/** 'month' | 'year' from a Stripe subscription's price. */
const intervalOf = (sub) =>
  sub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "year" : "month";

const customerIdOf = (sub) =>
  typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;

/**
 * Apply a Stripe Subscription's state onto the matching ACCOUNT, then mirror.
 * Resolves the account email from `metadata.accountEmail`, else legacy
 * `metadata.tenantId` → owner email, else the customer id already on file.
 */
const applyAccountSubscription = async (sub) => {
  let email = sub.metadata?.accountEmail || null;
  if (!email && sub.metadata?.tenantId) {
    email = await ownerEmailOfTenant(sub.metadata.tenantId);
  }
  if (!email) {
    const customerId = customerIdOf(sub);
    if (customerId) {
      const [rows] = await pool.query(
        "SELECT email FROM billing_accounts WHERE stripe_customer_id = ? LIMIT 1",
        [customerId]
      );
      email = rows[0]?.email || null;
    }
  }
  if (!email) return; // can't attribute — ignore

  const status = sub.status; // active | trialing | past_due | canceled | ...
  const isActive = ["active", "trialing", "past_due"].includes(status);
  const priceId = sub.items?.data?.[0]?.price?.id || null;
  const planName = isActive ? planByPriceId(priceId) || "free" : "free";
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;

  await setAccountPlan(email, {
    plan_name: planName,
    subscription_status: status,
    billing_interval: isActive ? intervalOf(sub) : null,
    stripe_customer_id: customerIdOf(sub),
    stripe_subscription_id: sub.id,
    current_period_end: isActive ? periodEnd : null,
  });
};

/**
 * Pull an account's latest subscription from Stripe and persist it (the no-webhook
 * fallback, mirroring reconcileTenantSubscription). No-op if Stripe isn't
 * configured. Preserves comped accounts (lifetime kept; expired timed → free).
 */
const reconcileAccount = async (email) => {
  if (!email || !isStripeConfigured()) return;
  const acct = await getAccount(email);

  if (acct.subscription_status === "comped") {
    const end = acct.current_period_end;
    if (end && new Date(end) < new Date()) {
      await resetAccountToFree(email, null);
    } else {
      await mirrorAccountToTenants(email); // keep tenants in sync with the comp
    }
    return;
  }

  const customerId = acct.stripe_customer_id;
  if (!customerId) return;

  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });
  const ranked = [...subs.data].sort((a, b) => b.created - a.created);
  const chosen =
    ranked.find((s) => ["active", "trialing", "past_due"].includes(s.status)) ||
    ranked[0];

  if (!chosen) {
    await resetAccountToFree(email, null);
    return;
  }
  if (!chosen.metadata?.accountEmail) {
    chosen.metadata = { ...chosen.metadata, accountEmail: email };
  }
  if (["canceled", "incomplete_expired"].includes(chosen.status)) {
    await resetAccountToFree(email, chosen.status);
  } else {
    await applyAccountSubscription(chosen);
  }

  // A scheduled downgrade has taken effect once the live plan matches the pending
  // target (or the schedule is gone) — clear the pending markers.
  const after = await getAccount(email);
  if (
    after.pending_plan &&
    (after.plan_name === after.pending_plan || !chosen.schedule)
  ) {
    await setAccountPlan(email, {
      pending_plan: null,
      pending_interval: null,
      pending_effective_at: null,
    });
  }
};

module.exports = {
  ownerEmailOfTenant,
  getAccount,
  ensureAccount,
  mirrorAccountToTenants,
  setAccountPlan,
  resetAccountToFree,
  applyAccountSubscription,
  reconcileAccount,
};
