/**
 * Tiny in-process TTL cache for hot, rarely-changing reads.
 *
 * WHY IN-MEMORY AND NOT REDIS: this app is a single Node service with a MySQL
 * backend and no Redis in the deployment. An in-process Map removes the DB
 * round-trip entirely (nanoseconds vs milliseconds) and adds zero infrastructure
 * to run or fail. The trade-offs are deliberate and bounded:
 *
 *   - Per-process. Under PM2 cluster mode each worker keeps its own copy, so a
 *     value may be served from up to N caches. Only used for data where a few
 *     seconds of staleness across workers is harmless (branding, plan flags).
 *   - Not shared across servers. Same reasoning.
 *
 * The API (get/set/wrap/invalidate) is intentionally the shape a Redis client
 * would expose, so swapping in `ioredis` later is a change to THIS file only.
 *
 * Safety: entries are capped (MAX_ENTRIES) and every entry has a TTL, so the
 * cache can never grow without bound — an unbounded cache is itself a memory
 * leak and a crash vector under heavy traffic.
 */

const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES) || 5000;

/** @type {Map<string, { value: any, expiresAt: number }>} */
const store = new Map();

const now = () => Date.now();

/** Drop one expired entry (or the oldest) to make room. Keeps eviction O(1)-ish. */
function evictOne() {
  // Map preserves insertion order, so the first key is the oldest.
  const oldestKey = store.keys().next().value;
  if (oldestKey !== undefined) store.delete(oldestKey);
}

function get(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

function set(key, value, ttlMs) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return value;
  if (store.size >= MAX_ENTRIES && !store.has(key)) evictOne();
  // Re-insert so the key moves to the end (most-recently-written).
  store.delete(key);
  store.set(key, { value, expiresAt: now() + ttlMs });
  return value;
}

/**
 * Cache-aside helper: return the cached value, or run `loader` and cache it.
 *
 * A rejected loader is NOT cached — otherwise one transient DB blip would be
 * served as a failure for the whole TTL.
 */
async function wrap(key, ttlMs, loader) {
  const cached = get(key);
  if (cached !== undefined) return cached;
  const value = await loader();
  // Never cache null/undefined: it makes a miss indistinguishable from a hit.
  if (value !== undefined && value !== null) set(key, value, ttlMs);
  return value;
}

/** Invalidate an exact key, or every key starting with `prefix:`. */
function invalidate(key) {
  store.delete(key);
}

function invalidatePrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

function clear() {
  store.clear();
}

function stats() {
  return { size: store.size, maxEntries: MAX_ENTRIES };
}

/**
 * Standard TTLs. Deliberately SHORT.
 *
 * Explicit invalidation only reaches the worker that handled the write (see the
 * per-process note above), so under cluster mode the TTL — not the invalidation
 * — is the real upper bound on how long another worker can serve stale data.
 *
 * 10s is chosen because the benefit curve is almost flat beyond it: against a
 * 500 req/s burst on one portal, a 10s TTL already collapses ~5000 DB lookups
 * into 1 per worker (>99.9%). Going to 60s buys a fraction of a percent more
 * while making a stale logo linger six times longer. Cheap insurance, bounded
 * cost.
 */
const TTL = {
  /** Portal branding/plan flags. */
  TENANT: Number(process.env.CACHE_TTL_TENANT_MS) || 10_000,
  /** Promotional offers: admin-controlled, must reflect changes quickly. */
  OFFERS: Number(process.env.CACHE_TTL_OFFERS_MS) || 10_000,
};

module.exports = { get, set, wrap, invalidate, invalidatePrefix, clear, stats, TTL };
