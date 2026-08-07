const dns = require("dns").promises;

/**
 * Email quality checks shared by invitations and the public board.
 *
 * `isDeliverableEmail` lived privately in src/main/invitations/invitations.js and
 * was never applied to public feedback submissions, so a guest post only had to
 * satisfy a regex — "a@b.co" passed. It is lifted here UNCHANGED in semantics so
 * the invitation flow behaves exactly as before, and reused on the public path.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Throwaway-inbox providers. Not a moral judgement — plenty of people use these
 * legitimately for privacy — which is why a hit only RAISES THE SPAM SCORE and
 * never blocks on its own (see spamScore.js). It is a weak signal that gains
 * meaning combined with others.
 *
 * Deliberately short and high-confidence. An exhaustive list is a losing race
 * (new domains appear daily) and a long tail of obscure entries buys accuracy we
 * don't need for a scoring signal.
 */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "fakeinbox.com",
  "mintemail.com",
  "spamgourmet.com",
]);

/**
 * MX lookups are a network round-trip, and this now sits on the visitor-facing
 * submit path rather than the once-per-invite path it was written for. Cache
 * results so a burst of submissions from one domain costs one DNS query.
 *
 * Bounded so it can't grow without limit under a domain-rotating flood — the
 * exact attack this module exists to help detect.
 */
const MX_CACHE = new Map();
const MX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MX_CACHE_MAX = 5000;

const cacheGet = (domain) => {
  const hit = MX_CACHE.get(domain);
  if (!hit) return undefined;
  if (Date.now() - hit.at > MX_CACHE_TTL_MS) {
    MX_CACHE.delete(domain);
    return undefined;
  }
  return hit.value;
};

const cacheSet = (domain, value) => {
  // Simple FIFO eviction — an LRU isn't worth the bookkeeping for a cache whose
  // entries all cost the same to recompute.
  if (MX_CACHE.size >= MX_CACHE_MAX) {
    const oldest = MX_CACHE.keys().next().value;
    if (oldest !== undefined) MX_CACHE.delete(oldest);
  }
  MX_CACHE.set(domain, { value, at: Date.now() });
};

/** Syntactic check only. */
const isValidEmailFormat = (email) => EMAIL_RE.test(String(email || "").trim());

/** Lowercased domain part, or "" when the address is unparseable. */
const emailDomain = (email) =>
  String(email || "").trim().toLowerCase().split("@")[1] || "";

/** Is the address at a known throwaway-inbox provider? */
const isDisposableEmail = (email) => DISPOSABLE_DOMAINS.has(emailDomain(email));

/**
 * Is this address plausibly real? Format first, then a best-effort MX lookup so
 * typos like "gmial.com" are caught.
 *
 * A DNS failure (offline, rate-limited, timeout) is NOT treated as invalid — we
 * only reject when the domain resolves with no mail exchanger. Preserved from the
 * original implementation, and load-bearing: this now runs on the submit path, so
 * treating an inconclusive lookup as failure would reject real feedback whenever
 * our own DNS hiccups.
 */
const isDeliverableEmail = async (email) => {
  const address = String(email || "").trim();
  if (!EMAIL_RE.test(address)) return false;

  const domain = address.split("@")[1];
  const cached = cacheGet(domain);
  if (cached !== undefined) return cached;

  let result;
  try {
    const mx = await dns.resolveMx(domain);
    result = Array.isArray(mx) && mx.length > 0;
  } catch (e) {
    if (e && (e.code === "ENOTFOUND" || e.code === "NXDOMAIN")) result = false;
    else result = true; // inconclusive — don't block
  }
  cacheSet(domain, result);
  return result;
};

module.exports = {
  EMAIL_RE,
  isValidEmailFormat,
  isDeliverableEmail,
  isDisposableEmail,
  emailDomain,
};
