const { pool } = require("../../database/dbPool");

/**
 * Burst caps for UNAUTHENTICATED public writes, counted in MySQL.
 *
 * WHY NOT JUST express-rate-limit? `publicWriteLimiter` keeps its counters in
 * each process's memory. PM2 runs one worker per core, so the real ceiling is
 * N x the configured max (its own source comment says so), and every deploy
 * resets it. That is fine as a cheap first filter and it stays in front of these
 * routes — but "flooding a board" is exactly the case it measures wrong.
 *
 * MySQL is already shared by every worker, so counting here is accurate without
 * introducing Redis as a new service to run, monitor and secure on the VPS.
 *
 * COST: one indexed upsert per public write. Negligible next to the inserts and
 * the notification fan-out those requests already perform.
 *
 * The most important cap is the PER-TENANT one: per-IP limits are defeated by a
 * proxy pool, but a board can only absorb so many new posts an hour regardless
 * of where they come from. That is the actual "don't let my board get flooded"
 * guarantee.
 */

/** Window sizes. Anything longer would need pruning to stay cheap. */
const WINDOW = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

const LIMITS = {
  /** New posts+comments on ONE board from ONE derived identity, per hour. */
  perVoterPerTenantHour:
    Number(process.env.SPAM_CAP_VOTER_HOUR) || 10,
  /** New posts+comments on ONE board from EVERYONE, per hour. */
  perTenantHour: Number(process.env.SPAM_CAP_TENANT_HOUR) || 60,
  /** Submissions from one email domain to one board, per day. */
  perEmailDomainDay: Number(process.env.SPAM_CAP_DOMAIN_DAY) || 30,
};

/** Start of the current fixed window, as a MySQL DATETIME string. */
function windowStart(sizeMs, now = Date.now()) {
  const floored = Math.floor(now / sizeMs) * sizeMs;
  return new Date(floored).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Increment a counter and return its new value.
 *
 * Fixed windows, not a sliding log: a burst straddling a boundary can briefly
 * reach ~2x the cap. Accepted deliberately — the alternative (per-event rows)
 * costs far more storage and cleanup for a bound that is already approximate,
 * and every other layer still applies.
 *
 * @returns {Promise<number>} the count INCLUDING this request
 */
async function bump(scopeKey, sizeMs) {
  const start = windowStart(sizeMs);
  // Atomic even under concurrent workers: the PK makes this a single row upsert,
  // and LAST_INSERT_ID(expr) hands back the post-increment value on the same
  // connection without a second SELECT (which would race).
  const [res] = await pool.query(
    `INSERT INTO public_write_counters (scope_key, window_start, count)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE count = LAST_INSERT_ID(count + 1)`,
    [scopeKey.slice(0, 100), start]
  );
  // insertId is 1 for a fresh row (the inserted count), otherwise whatever
  // LAST_INSERT_ID was set to above.
  return res.insertId || 1;
}

/**
 * Charge a public write against every applicable cap.
 *
 * FAILS OPEN. If the counter table is unreachable we let the write through
 * rather than take the board offline — the in-memory limiter and the content
 * scorer are still in play, and a DB blip must not look like a spam block to
 * every legitimate visitor.
 *
 * @param {object} args
 * @param {number} args.tenantId
 * @param {string|null} args.voterHash
 * @param {string} [args.emailDomain]
 * @returns {Promise<{ ok: boolean, scope: string|null }>} scope names the cap
 *   that tripped, for logging — it is deliberately NOT surfaced to the caller's
 *   response, which stays a generic 429.
 */
async function chargePublicWrite({ tenantId, voterHash, emailDomain }) {
  try {
    const checks = [];

    if (voterHash) {
      checks.push({
        key: `v:${voterHash}:${tenantId}`,
        size: WINDOW.hour,
        max: LIMITS.perVoterPerTenantHour,
        scope: "voter_hour",
      });
    }

    checks.push({
      key: `t:${tenantId}`,
      size: WINDOW.hour,
      max: LIMITS.perTenantHour,
      scope: "tenant_hour",
    });

    if (emailDomain) {
      checks.push({
        key: `d:${emailDomain}:${tenantId}`,
        size: WINDOW.day,
        max: LIMITS.perEmailDomainDay,
        scope: "domain_day",
      });
    }

    // Every counter is bumped even once one has tripped, so a caller hammering a
    // blocked endpoint still accrues against its other scopes rather than
    // getting free requests on them.
    const results = await Promise.all(
      checks.map((c) => bump(c.key, c.size).then((count) => ({ ...c, count })))
    );

    const tripped = results.find((r) => r.count > r.max);
    return tripped ? { ok: false, scope: tripped.scope } : { ok: true, scope: null };
  } catch (error) {
    console.error("writeCounters: failing open —", error.message);
    return { ok: true, scope: null };
  }
}

/**
 * Drop elapsed windows. Called opportunistically (see below) rather than on a
 * timer so it needs no scheduler and no cluster coordination.
 */
async function pruneCounters() {
  try {
    await pool.query(
      "DELETE FROM public_write_counters WHERE window_start < (NOW() - INTERVAL 2 DAY)"
    );
  } catch {
    /* housekeeping only — never surface */
  }
}

// Rows are tiny and bounded by (distinct scopes x windows), but without this the
// table grows forever. A ~1-in-500 chance per write keeps it trimmed with no
// cron and negligible overhead.
const PRUNE_PROBABILITY = 1 / 500;
function maybePrune() {
  if (Math.random() < PRUNE_PROBABILITY) pruneCounters().catch(() => {});
}

module.exports = { chargePublicWrite, pruneCounters, maybePrune, LIMITS };
