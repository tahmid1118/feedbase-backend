/**
 * One-off helper: create the Pro and Business Products + their monthly AND yearly
 * recurring Prices in your Paddle account, then print the Price IDs to paste into
 * `.env`. Runs against SANDBOX or PRODUCTION depending on PADDLE_ENV / your key;
 * it prints the mode before creating anything.
 *
 * IMPORTANT: sandbox and production prices are SEPARATE. When you go live, run this
 * again with production keys and replace the PADDLE_PRICE_* values in `.env`.
 *
 * The yearly price is the monthly price x 12 with YEARLY_DISCOUNT (20%) off — a
 * genuinely cheaper price, matching the Stripe setup and lib/plans.ts.
 *
 * Usage:
 *   1. Set PADDLE_API_KEY (+ PADDLE_ENV=sandbox) in .env.
 *   2. node scripts/paddle-setup.js
 *   3. Copy the printed PADDLE_PRICE_* lines into .env.
 *
 * Safe to re-run: it looks up existing products/prices before creating.
 */
require("dotenv").config();
const { Paddle, Environment } = require("@paddle/paddle-node-sdk");
const { YEARLY_DISCOUNT } = require("../src/consts/plans");

const TIERS = [
  { key: "pro", name: "FeedBoard Pro", amount: 1000, envVar: "PADDLE_PRICE_PRO" },
  { key: "business", name: "FeedBoard Business", amount: 1500, envVar: "PADDLE_PRICE_BUSINESS" },
];

// Yearly total in minor units (cents), whole-dollar per-month equivalent x 12.
const yearlyAmount = (monthly) =>
  Math.round((monthly / 100) * (1 - YEARLY_DISCOUNT)) * 100 * 12;

/** Collect a Paddle list Collection into an array. */
async function collect(collection) {
  const out = [];
  for await (const item of collection) out.push(item);
  return out;
}

async function findOrCreateProduct(paddle, name) {
  const products = await collect(paddle.products.list({ status: ["active"] }));
  const existing = products.find((p) => p.name === name);
  if (existing) {
    console.log(`Found product: ${name} (${existing.id})`);
    return existing;
  }
  const created = await paddle.products.create({ name, taxCategory: "standard" });
  console.log(`Created product: ${name} (${created.id})`);
  return created;
}

/** Find (or create) an active recurring USD price for a product + interval. */
async function ensurePrice(paddle, product, amount, interval) {
  const prices = await collect(paddle.prices.list({ productId: [product.id], status: ["active"] }));
  const existing = prices.find(
    (p) =>
      p.unitPrice?.amount === String(amount) &&
      p.unitPrice?.currencyCode === "USD" &&
      p.billingCycle?.interval === interval
  );
  if (existing) return existing;
  return paddle.prices.create({
    description: `${product.name} (${interval}ly)`,
    productId: product.id,
    unitPrice: { amount: String(amount), currencyCode: "USD" },
    billingCycle: { interval, frequency: 1 },
    quantity: { minimum: 1, maximum: 1 },
  });
}

(async () => {
  if (!process.env.PADDLE_API_KEY) {
    console.error("✗ PADDLE_API_KEY is not set in .env");
    process.exit(1);
  }
  const mode = process.env.PADDLE_ENV === "production" ? "production" : "sandbox";
  const paddle = new Paddle(process.env.PADDLE_API_KEY, {
    environment: mode === "production" ? Environment.production : Environment.sandbox,
  });
  console.log(`▶ Creating products/prices in Paddle ${mode.toUpperCase()} mode.\n`);

  const out = {};
  for (const tier of TIERS) {
    const product = await findOrCreateProduct(paddle, tier.name);

    const monthly = await ensurePrice(paddle, product, tier.amount, "month");
    out[tier.envVar] = monthly.id;
    console.log(`  ${tier.envVar}=${monthly.id}  ($${(tier.amount / 100).toFixed(2)}/mo)`);

    const yAmount = yearlyAmount(tier.amount);
    const yearly = await ensurePrice(paddle, product, yAmount, "year");
    out[`${tier.envVar}_YEARLY`] = yearly.id;
    console.log(
      `  ${tier.envVar}_YEARLY=${yearly.id}  ($${(yAmount / 100).toFixed(2)}/yr — ${YEARLY_DISCOUNT * 100}% off)`
    );
  }

  console.log("\nPaste these into your .env:\n");
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
  process.exit(0);
})().catch((err) => {
  console.error("✗ Paddle setup failed:", err.message);
  process.exit(1);
});
