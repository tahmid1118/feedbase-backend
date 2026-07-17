/**
 * One-off helper: create the Pro and Business Products + their monthly AND
 * yearly Prices in your Stripe account (test mode), then print the Price IDs to
 * paste into `.env`.
 *
 * The yearly price is the monthly price × 12 with YEARLY_DISCOUNT (20%) off, so
 * it's a genuinely cheaper price rather than a coupon.
 *
 * Usage:
 *   1. Set STRIPE_SECRET_KEY in .env (a test key, sk_test_...).
 *   2. node scripts/stripe-setup.js
 *   3. Copy STRIPE_PRICE_PRO / _BUSINESS and STRIPE_PRICE_PRO_YEARLY /
 *      _BUSINESS_YEARLY into .env.
 *
 * Safe to re-run: it looks up existing products/prices before creating.
 */
require("dotenv").config();
const Stripe = require("stripe");
const { YEARLY_DISCOUNT } = require("../src/consts/plans");

const TIERS = [
  { key: "pro", name: "Feedbase Pro", amount: 1000, envVar: "STRIPE_PRICE_PRO" },
  { key: "business", name: "Feedbase Business", amount: 1500, envVar: "STRIPE_PRICE_BUSINESS" },
];

/**
 * Yearly total in cents. The per-month equivalent is rounded to a WHOLE dollar
 * first (so both the monthly-equivalent and the annual total stay integers —
 * e.g. Pro $19 → $15/mo → $180/yr), then multiplied by 12.
 */
const yearlyAmount = (monthlyAmount) =>
  Math.round((monthlyAmount / 100) * (1 - YEARLY_DISCOUNT)) * 100 * 12;

async function findProductByName(stripe, name) {
  const list = await stripe.products.list({ limit: 100, active: true });
  return list.data.find((p) => p.name === name) || null;
}

/** Find (or create) an active recurring USD price for a product + interval. */
async function ensurePrice(stripe, product, amount, interval) {
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const existing = prices.data.find(
    (p) =>
      p.unit_amount === amount &&
      p.recurring?.interval === interval &&
      p.currency === "usd"
  );
  if (existing) return existing;
  return stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: "usd",
    recurring: { interval },
  });
}

(async () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("✗ STRIPE_SECRET_KEY is not set in .env");
    process.exit(1);
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

  const out = {};
  for (const tier of TIERS) {
    let product = await findProductByName(stripe, tier.name);
    if (!product) {
      product = await stripe.products.create({ name: tier.name, metadata: { plan: tier.key } });
      console.log(`Created product: ${tier.name} (${product.id})`);
    } else {
      console.log(`Found product: ${tier.name} (${product.id})`);
    }

    const monthly = await ensurePrice(stripe, product, tier.amount, "month");
    out[tier.envVar] = monthly.id;
    console.log(`  ${tier.envVar}=${monthly.id}  ($${(tier.amount / 100).toFixed(2)}/mo)`);

    const yAmount = yearlyAmount(tier.amount);
    const yearly = await ensurePrice(stripe, product, yAmount, "year");
    out[`${tier.envVar}_YEARLY`] = yearly.id;
    console.log(
      `  ${tier.envVar}_YEARLY=${yearly.id}  ($${(yAmount / 100).toFixed(2)}/yr — ${YEARLY_DISCOUNT * 100}% off)`
    );
  }

  console.log("\nPaste these into your .env:\n");
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
  process.exit(0);
})().catch((err) => {
  console.error("✗ Stripe setup failed:", err.message);
  process.exit(1);
});
