/**
 * Subscription plans — the single source of truth for billing tiers on the
 * backend. Stripe Price IDs come from the environment (created once via
 * `scripts/stripe-setup.js`); the `free` tier has no Stripe price.
 *
 * `limits` are the capabilities enforced by `src/common/planGuard.js`:
 *   - customDomain / integrations: boolean feature gates (enforced today)
 *   - seats: max team members (displayed; enforced once an invite flow exists)
 */
const PLANS = {
  free: {
    key: "free",
    label: "Free",
    priceId: null,
    limits: { seats: 2, customDomain: false, integrations: false },
  },
  pro: {
    key: "pro",
    label: "Pro",
    priceId: process.env.STRIPE_PRICE_PRO || null,
    limits: { seats: 10, customDomain: true, integrations: true },
  },
  business: {
    key: "business",
    label: "Business",
    priceId: process.env.STRIPE_PRICE_BUSINESS || null,
    limits: { seats: Infinity, customDomain: true, integrations: true },
  },
};

const VALID_PLAN_KEYS = Object.keys(PLANS);

/** Map a Stripe Price ID back to a plan key (used by the webhook). */
const planByPriceId = (priceId) => {
  if (!priceId) return null;
  const match = Object.values(PLANS).find((p) => p.priceId === priceId);
  return match ? match.key : null;
};

/** Limits for a plan name, falling back to the free tier for unknown values. */
const getPlanLimits = (planName) =>
  (PLANS[planName] || PLANS.free).limits;

module.exports = { PLANS, VALID_PLAN_KEYS, planByPriceId, getPlanLimits };
