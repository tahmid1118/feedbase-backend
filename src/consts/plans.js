/**
 * Subscription plans — the single source of truth for billing tiers on the
 * backend. Stripe Price IDs come from the environment (created once via
 * `scripts/stripe-setup.js`); the `free` tier has no Stripe price.
 *
 * `limits` are the capabilities enforced by `src/common/planGuard.js`:
 *   - customDomain / integrations: boolean feature gates (enforced today)
 *   - deleteFeedback: whether feedback posts can be deleted (owner-only, paid)
 *   - attachments: whether feedback posts may carry photo/video attachments
 *   - multiDevice: may be signed in on several devices/browsers at once
 *   - seats: max team members (displayed; enforced once an invite flow exists)
 */
// `price` is the monthly list price (USD) — the display baseline that offers
// discount from. Keep it in sync with the Stripe prices + `lib/plans.ts`.
const PLANS = {
  free: {
    key: "free",
    label: "Free",
    price: 0,
    priceId: null,
    limits: {
      seats: 2,
      customDomain: false,
      integrations: false,
      deleteFeedback: false,
      attachments: false,
      multiDevice: false,
    },
  },
  pro: {
    key: "pro",
    label: "Pro",
    price: 19,
    priceId: process.env.STRIPE_PRICE_PRO || null,
    limits: {
      seats: 10,
      customDomain: true,
      integrations: true,
      deleteFeedback: true,
      attachments: true,
      multiDevice: false,
    },
  },
  business: {
    key: "business",
    label: "Business",
    price: 49,
    priceId: process.env.STRIPE_PRICE_BUSINESS || null,
    limits: {
      seats: Infinity,
      customDomain: true,
      integrations: true,
      deleteFeedback: true,
      attachments: true,
      multiDevice: true,
    },
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
