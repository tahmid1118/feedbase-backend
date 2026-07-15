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
 *   - seats: max team members BESIDES the owner (the owner is never counted),
 *       so Free = owner + 2, Pro = owner + 5, Business = unlimited. Enforced at
 *       invite time in `invitations.js`.
 *   - ownWorkspaces / joinWorkspaces: per-ACCOUNT caps (not per-tenant) on how
 *       many workspaces an email may OWN and be a MEMBER of. Governed by the
 *       account's tier = the highest plan among the workspaces it owns (see
 *       `getAccountTier` in planGuard). Free owns 1 / joins 1, Pro 3 / 3,
 *       Business unlimited. Enforced in `workspaces.js` (create) and
 *       `invitations.js` (accept).
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
      ownWorkspaces: 1,
      joinWorkspaces: 1,
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
      seats: 5,
      ownWorkspaces: 3,
      joinWorkspaces: 3,
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
      ownWorkspaces: Infinity,
      joinWorkspaces: Infinity,
      customDomain: true,
      integrations: true,
      deleteFeedback: true,
      attachments: true,
      multiDevice: true,
    },
  },
};

const VALID_PLAN_KEYS = Object.keys(PLANS);

/** Tier ordering, low → high. Used to pick an account's effective plan. */
const PLAN_RANK = { free: 0, pro: 1, business: 2 };

/** The highest-tier plan among a list of plan names (defaults to "free"). */
const maxPlan = (planNames) => {
  let best = "free";
  for (const p of planNames || []) {
    if ((PLAN_RANK[p] ?? 0) > (PLAN_RANK[best] ?? 0)) best = p;
  }
  return best;
};

/** Map a Stripe Price ID back to a plan key (used by the webhook). */
const planByPriceId = (priceId) => {
  if (!priceId) return null;
  const match = Object.values(PLANS).find((p) => p.priceId === priceId);
  return match ? match.key : null;
};

/** Limits for a plan name, falling back to the free tier for unknown values. */
const getPlanLimits = (planName) =>
  (PLANS[planName] || PLANS.free).limits;

module.exports = { PLANS, VALID_PLAN_KEYS, PLAN_RANK, maxPlan, planByPriceId, getPlanLimits };
