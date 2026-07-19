const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * Rate limiting. Three tiers, because the risk profile differs sharply by route:
 *
 *   apiLimiter     — a wide safety net on everything (accidental client loops,
 *                    scrapers, crude floods).
 *   authLimiter    — tight, on credential endpoints. These are the brute-force
 *                    targets, and each attempt costs a bcrypt hash (~100ms of
 *                    CPU), so an unthrottled login endpoint is a CPU DoS as much
 *                    as an account-security hole.
 *   publicWriteLimiter — tight, on UNAUTHENTICATED writes (guest posts,
 *                    comments, votes). No account is needed to reach these, so
 *                    they are the cheapest surface to abuse for spam.
 *
 * Responses reuse setServerResponse so a throttled client gets the same
 * { status, message } envelope (and localized text) as every other error.
 *
 * NOTE ON MULTI-INSTANCE: counters are per-process, in memory. Under PM2
 * cluster mode with N workers the effective ceiling is N x the configured max.
 * That is still a hard bound and fine as a safety net; for exact global limits,
 * back these with a shared store (see rate-limit-redis) once Redis exists.
 */

const isProd = process.env.NODE_ENV === "production";

/** Uniform 429 body, localized from the request's `lg` when present. */
const limitResponse = (messageKey) => (req, res) => {
  const lg = req.body?.lg || "en";
  res
    .status(API_STATUS_CODE.TOO_MANY_REQUESTS)
    .json(setServerResponse(API_STATUS_CODE.TOO_MANY_REQUESTS, messageKey, lg));
};

const baseOptions = {
  standardHeaders: "draft-7", // RateLimit-* headers so clients can back off
  legacyHeaders: false,
  // Skip counting successful preflights — they are not a threat and would
  // otherwise eat a browser's budget before the real request lands.
  skip: (req) => req.method === "OPTIONS",
};

/**
 * Global net. Deliberately generous: a legitimate dashboard user can fire a
 * burst of calls on page load, and this must never be what breaks them.
 */
const apiLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_GLOBAL_MAX) || 300, // per IP per minute
  handler: limitResponse("too_many_requests"),
});

/**
 * Credential endpoints (login, register, admin login, password reset).
 * Counts only FAILURES, so a user with correct credentials is never locked out
 * by their own successful traffic, while a password-guesser burns the budget.
 */
const authLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_AUTH_MAX) || 10,
  skipSuccessfulRequests: true,
  handler: limitResponse("too_many_attempts"),
});

/**
 * Unauthenticated public writes. Keyed by IP *and* tenant, so flooding one
 * workspace's board cannot exhaust the budget for every other tenant's
 * visitors sharing a NAT/proxy IP.
 */
const publicWriteLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PUBLIC_WRITE_MAX) || 15,
  keyGenerator: (req, res) =>
    // ipKeyGenerator normalizes IPv6 into a /64 subnet — a single IPv6 host can
    // otherwise trivially rotate addresses within its own prefix.
    `${ipKeyGenerator(req, res)}:${req.params?.subdomain || "-"}`,
  handler: limitResponse("too_many_requests"),
});

/**
 * Expensive one-off actions that fan out email or hit a third party
 * (invitations, "notify implemented", checkout session creation).
 */
const expensiveActionLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_EXPENSIVE_MAX) || 30,
  handler: limitResponse("too_many_requests"),
});

module.exports = {
  apiLimiter,
  authLimiter,
  publicWriteLimiter,
  expensiveActionLimiter,
  isProd,
};
