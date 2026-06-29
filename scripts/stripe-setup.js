/**
 * One-off helper: create the Pro and Business Products + monthly Prices in your
 * Stripe account (test mode), then print the Price IDs to paste into `.env`.
 *
 * Usage:
 *   1. Set STRIPE_SECRET_KEY in .env (a test key, sk_test_...).
 *   2. node scripts/stripe-setup.js
 *   3. Copy STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS into .env.
 *
 * Safe to re-run: it looks up existing products by name before creating.
 */
require("dotenv").config();
const Stripe = require("stripe");

const TIERS = [
  { key: "pro", name: "Feedbase Pro", amount: 1900, envVar: "STRIPE_PRICE_PRO" },
  { key: "business", name: "Feedbase Business", amount: 4900, envVar: "STRIPE_PRICE_BUSINESS" },
];

async function findProductByName(stripe, name) {
  const list = await stripe.products.list({ limit: 100, active: true });
  return list.data.find((p) => p.name === name) || null;
}

async function ensurePrice(stripe, product, amount) {
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const existing = prices.data.find(
    (p) => p.unit_amount === amount && p.recurring?.interval === "month" && p.currency === "usd"
  );
  if (existing) return existing;
  return stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: "usd",
    recurring: { interval: "month" },
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
    const price = await ensurePrice(stripe, product, tier.amount);
    out[tier.envVar] = price.id;
    console.log(`  ${tier.envVar}=${price.id}  ($${(tier.amount / 100).toFixed(2)}/mo)`);
  }

  console.log("\nPaste these into your .env:\n");
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
  process.exit(0);
})().catch((err) => {
  console.error("✗ Stripe setup failed:", err.message);
  process.exit(1);
});
