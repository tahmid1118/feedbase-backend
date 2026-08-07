const crypto = require("crypto");

/**
 * Server-derived identity for anonymous public-board visitors.
 *
 * THE PROBLEM THIS SOLVES. The portal sends a `guestId` in the request body
 * (`lib/portal/guest.ts` → a cookie it generates itself). That value is entirely
 * client-controlled, so `UNIQUE (tenant_id, post_id, guest_id)` on `votes` stops
 * an honest browser and nothing else: a bot that sends a fresh UUID per request
 * votes as many times as it likes. Anything used for abuse control has to be
 * derived from something the caller cannot pick.
 *
 * WHAT WE DERIVE IT FROM. The client IP, which `app.js` already resolves
 * correctly (`app.set("trust proxy", …)`, so `req.ip` is the real address behind
 * Traefik rather than the proxy's).
 *
 * WHY IT'S HASHED. A raw IP is personal data under GDPR and we have no reason to
 * keep one — every use here is equality comparison, which a hash serves equally
 * well. Storing the hash keeps the privacy policy honest (see app/legal/privacy)
 * and means a database leak doesn't expose visitors' addresses.
 *
 * `guest_id` is NOT replaced: it still drives the display pseudonym + avatar
 * colour (`lib/portal/anon-identity.ts`). The two are now cleanly separated —
 * client-supplied identity for DISPLAY, server-derived identity for TRUST.
 *
 * KNOWN LIMIT, stated plainly: this bounds one IP, not one person. A rotating
 * proxy pool defeats it. That is why it is one layer of several — the per-tenant
 * burst cap in writeCounters.js is what bounds the pool case. The goal is to make
 * flooding uneconomic, not impossible; genuinely unforgeable identity is not
 * achievable without making people sign in, which is the friction we are
 * deliberately avoiding.
 */

/**
 * The HMAC key. Falls back to the JWT secret so the server still boots (and
 * behaves correctly) without new configuration — but a dedicated salt is
 * preferable so rotating it doesn't invalidate every session.
 *
 * Rotating this salt resets all voter identities: past votes keep their old hash
 * and no longer match the new one, so a visitor could vote once more per post.
 * That is a deliberate trade (rotation is a privacy feature) and is harmless at
 * this scale, but don't rotate it on a schedule expecting it to be free.
 */
const SALT =
  process.env.SPAM_HASH_SALT || process.env.SECRET_ACCESS_TOKEN || "";

/**
 * Stable, non-reversible id for the request's origin. 64 hex chars, matching the
 * VARCHAR(64) columns on posts/comments/votes.
 *
 * Returns null when no IP can be determined — callers must treat that as "no
 * trusted identity" and lean on their other layers rather than grouping every
 * such request under one shared bucket (which would let one bad actor lock out
 * every unknown-IP visitor).
 *
 * @param {import("express").Request} req
 * @returns {string|null}
 */
function voterHash(req) {
  const ip = (req?.ip || "").trim();
  if (!ip) return null;
  return crypto.createHmac("sha256", SALT).update(ip).digest("hex");
}

module.exports = { voterHash };
