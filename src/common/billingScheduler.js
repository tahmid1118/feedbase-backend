/**
 * Periodic billing maintenance.
 *
 * Paddle has no native "change this subscription's plan at the end of the period",
 * so a **yearly → monthly** downgrade is recorded as pending_* markers and applied
 * near the period end by this scheduler (see `paddleBilling.applyDuePendingChanges`).
 * Without it that change would never take effect and the customer would be billed
 * for another full year — so this is money-critical, not cosmetic.
 *
 * CLUSTER SAFETY. PM2 runs one worker per core (ecosystem.config.js `exec_mode:
 * cluster`), and every worker would otherwise run this loop, applying the same
 * change N times. Workers share the MySQL server but not memory, so we serialise
 * with a MySQL **advisory lock** (`GET_LOCK`): whoever wins the tick does the sweep,
 * the rest return immediately. The lock is connection-scoped, so it is taken and
 * released on ONE dedicated pooled connection. (The sweep is also written to be
 * idempotent — it skips subscriptions whose item already matches the target — so a
 * lock failure degrades to wasted work, never a double charge.)
 *
 * Env:
 *   BILLING_SCHEDULER=off        disable entirely (default: on when Paddle is set up)
 *   BILLING_SCHEDULER_MINUTES=30 tick interval (default 30)
 *   BILLING_SCHEDULER_LEAD_HOURS=6
 *                                how far BEFORE the renewal a due change may be
 *                                applied. Bigger = more resilient to downtime/missed
 *                                ticks; the proration credit makes running early
 *                                financially neutral.
 */
const { pool } = require("../../database/dbPool");
const { isPaddleConfigured } = require("./paddle");
const { isPaddleActive } = require("./billingProvider");

const LOCK_NAME = "feedboard_billing_scheduler";
const num = (v, dflt) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : dflt);

let timer = null;

/** Run `fn` only if this worker wins the cross-process advisory lock. */
const withLock = async (fn) => {
  const conn = await pool.getConnection();
  try {
    const [[got]] = await conn.query("SELECT GET_LOCK(?, 0) AS ok", [LOCK_NAME]);
    if (!got || Number(got.ok) !== 1) return false; // another worker is sweeping
    try {
      await fn();
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
    }
    return true;
  } finally {
    conn.release();
  }
};

const tick = async () => {
  const leadSeconds = num(process.env.BILLING_SCHEDULER_LEAD_HOURS, 6) * 3600;
  try {
    await withLock(async () => {
      const { applyDuePendingChanges } = require("../main/billing/paddleBilling");
      const { applied } = await applyDuePendingChanges({ leadSeconds });
      if (applied > 0) console.log(`billing scheduler: applied ${applied} pending plan change(s)`);
    });
  } catch (e) {
    // Never let a sweep failure take the process down — it retries next tick.
    console.error("billing scheduler tick failed:", e.message);
  }
};

/** Start the periodic sweep. No-op when disabled or when Paddle isn't the provider. */
const startBillingScheduler = () => {
  if (timer) return;
  if (process.env.BILLING_SCHEDULER === "off") return;
  if (!isPaddleActive() || !isPaddleConfigured()) return;

  const minutes = num(process.env.BILLING_SCHEDULER_MINUTES, 30);
  timer = setInterval(tick, minutes * 60 * 1000);
  // Don't hold the event loop open on shutdown.
  if (typeof timer.unref === "function") timer.unref();
  console.log(`Billing scheduler started (every ${minutes}m).`);
  // Run one sweep shortly after boot so a restart doesn't skip a due change.
  setTimeout(() => { tick(); }, 30 * 1000).unref?.();
};

const stopBillingScheduler = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { startBillingScheduler, stopBillingScheduler, tick };
