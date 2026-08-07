const crypto = require("crypto");

/**
 * Signed "this submission came from a real page view" token.
 *
 * The portal board page (a Server Component) mints one and hands it to the submit
 * and comment forms; posting sends it back. It proves two things a bot posting
 * straight at the API cannot fake:
 *
 *   1. The caller loaded a page we served (the HMAC can't be forged without the
 *      secret).
 *   2. Time passed between that page load and the submission — a human reads,
 *      thinks and types; a script does not.
 *
 * DELIBERATELY NOT A HARD GATE. `verifyFormToken` reports a verdict and the
 * caller folds it into the spam score, because:
 *   - `/public/*` is a documented API, and legitimate non-browser clients exist;
 *   - a hard reject on day one turns any bug here into "nobody can submit
 *     feedback", which is far worse than letting some spam through.
 * A missing or bad token is evidence, not a verdict.
 */

const SECRET =
  process.env.SPAM_HASH_SALT || process.env.SECRET_ACCESS_TOKEN || "";

/**
 * Minimum plausible time between loading a board and submitting feedback.
 * Someone still has to read the board, open the dialog, and type a title and an
 * email address. Three seconds is comfortably under any real human and far above
 * a script, which submits in milliseconds.
 */
const MIN_AGE_MS = Number(process.env.FORM_TOKEN_MIN_AGE_MS) || 3000;

/**
 * Upper bound, mostly an anti-replay measure: it stops one harvested token being
 * reused indefinitely. Generous because leaving a tab open all day and then
 * commenting is perfectly normal behaviour.
 */
const MAX_AGE_MS = Number(process.env.FORM_TOKEN_MAX_AGE_MS) || 24 * 60 * 60 * 1000;

/** `<issuedAtMs>.<hmac>` — opaque to the client, cheap to verify. */
function issueFormToken(now = Date.now()) {
  const issuedAt = String(now);
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(issuedAt)
    .digest("hex");
  return `${issuedAt}.${sig}`;
}

/**
 * @returns {{ valid: boolean, reason: string|null, ageMs: number|null }}
 *   reason ∈ 'missing' | 'malformed' | 'bad_signature' | 'too_fast' | 'expired'
 */
function verifyFormToken(token, now = Date.now()) {
  const raw = String(token || "").trim();
  if (!raw) return { valid: false, reason: "missing", ageMs: null };

  const dot = raw.indexOf(".");
  if (dot <= 0) return { valid: false, reason: "malformed", ageMs: null };

  const issuedAt = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!/^\d+$/.test(issuedAt)) {
    return { valid: false, reason: "malformed", ageMs: null };
  }

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(issuedAt)
    .digest("hex");

  // Constant-time compare. timingSafeEqual throws on length mismatch, so guard
  // first — both are fixed-length hex here, but a malformed token is attacker
  // controlled and must not be able to raise.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad_signature", ageMs: null };
  }

  // Clock skew or a token minted "in the future" reads as age <= 0, which the
  // too_fast branch already covers.
  const ageMs = now - Number(issuedAt);
  if (ageMs < MIN_AGE_MS) return { valid: false, reason: "too_fast", ageMs };
  if (ageMs > MAX_AGE_MS) return { valid: false, reason: "expired", ageMs };

  return { valid: true, reason: null, ageMs };
}

module.exports = { issueFormToken, verifyFormToken, MIN_AGE_MS, MAX_AGE_MS };
