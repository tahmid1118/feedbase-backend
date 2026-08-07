const { voterHash } = require("./guestIdentity");
const { verifyFormToken } = require("./formToken");
const { spamScore, moderationStateFor, isFlagged } = require("./spamScore");
const { chargePublicWrite, maybePrune } = require("./writeCounters");
const {
  isDisposableEmail,
  isDeliverableEmail,
  emailDomain,
  isValidEmailFormat,
} = require("./emailQuality");

/**
 * The shared spam gate for anonymous public-board writes (posts and comments).
 *
 * Ordered cheapest-check-first, so an obvious bot costs us almost nothing:
 *
 *   1. Honeypot      — pure string check, no I/O.
 *   2. Form token    — one HMAC.
 *   3. Burst caps    — one indexed upsert per scope.
 *   4. Email quality — cached DNS, only for guests who supplied an address.
 *   5. Content score — pure function.
 *
 * Callers own their own duplicate query (posts compare title+description,
 * comments compare a body) and pass the count in, which keeps this module free
 * of table-specific SQL.
 */

/**
 * Name of the hidden field the forms render. Chosen to look like something worth
 * filling in to a naive bot scanning for inputs.
 */
const HONEYPOT_FIELD = "website";

/**
 * @param {object} args
 * @param {number} args.tenantId
 * @param {import("express").Request} args.req
 * @param {object} args.data              raw request body
 * @param {string} [args.title]
 * @param {string} [args.body]
 * @param {string|null} [args.email]      guest-supplied contact address
 * @param {number} [args.duplicateCount]
 * @param {boolean} [args.isAuthenticated] logged-in writes skip content scoring
 * @returns {Promise<{
 *   discard: boolean, rateLimited: boolean, voterHash: string|null,
 *   score: number, reasons: string[], moderationState: string, flagged: boolean
 * }>}
 */
async function evaluatePublicWrite({
  tenantId,
  req,
  data,
  title = "",
  body = "",
  email = null,
  duplicateCount = 0,
  isAuthenticated = false,
}) {
  const hash = voterHash(req);

  const clean = {
    discard: false,
    rateLimited: false,
    voterHash: hash,
    score: 0,
    reasons: [],
    moderationState: "published",
    flagged: false,
  };

  // 1. Honeypot. A human never sees this field, so any value at all means a bot
  //    filled the form programmatically. The caller reports SUCCESS and drops the
  //    content on the floor — an error response would teach the bot to adapt.
  if (String(data?.[HONEYPOT_FIELD] || "").trim() !== "") {
    return { ...clean, discard: true };
  }

  // A signed-in author is accountable and already rate-limited by their session;
  // scoring their words would mean quarantining a paying customer's own comment.
  // They still pass through the honeypot check above (it costs nothing) but skip
  // everything below.
  if (isAuthenticated) return clean;

  // 2. Provenance.
  const token = verifyFormToken(data?.formToken);

  // 3. Burst caps. Charged before the DNS lookup so a flood can't make us
  //    resolve thousands of domains.
  const domain = email ? emailDomain(email) : "";
  const charge = await chargePublicWrite({
    tenantId,
    voterHash: hash,
    emailDomain: domain || undefined,
  });
  maybePrune();
  if (!charge.ok) {
    return { ...clean, rateLimited: true };
  }

  // 4. Email quality. Only meaningful for a syntactically valid address; the
  //    handlers reject malformed ones outright before this runs.
  let disposable = false;
  let noMx = false;
  if (email && isValidEmailFormat(email)) {
    disposable = isDisposableEmail(email);
    // isDeliverableEmail returns false only when the domain RESOLVED with no
    // mail exchanger — an inconclusive lookup is treated as fine, so our own DNS
    // trouble never scores against a visitor.
    noMx = !(await isDeliverableEmail(email));
  }

  // 5. Content.
  const { score, reasons } = spamScore({
    title,
    body,
    isDisposableEmail: disposable,
    emailHasNoMx: noMx,
    formTokenReason: token.valid ? null : token.reason,
    duplicateCount,
  });

  return {
    ...clean,
    score,
    reasons,
    moderationState: moderationStateFor(score),
    flagged: isFlagged(score),
  };
}

module.exports = { evaluatePublicWrite, HONEYPOT_FIELD };
