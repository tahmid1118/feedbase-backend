/**
 * Content-based spam scoring for anonymous public-board submissions.
 *
 * A PURE FUNCTION on purpose — no DB, no network, no request object. Everything
 * it needs is passed in, so it can be unit-tested against a fixture set without
 * standing up a database, which is the only practical way to tune weights
 * without guessing.
 *
 * DESIGN BIAS: this is a FEEDBACK board. The costly mistake is quarantining a
 * real customer complaint, not letting a casino link through for an hour. Angry,
 * shouty, badly written feedback is still real feedback — "your pricing is a
 * scam and support ignored me" must stay well below the flag threshold. So:
 *
 *   - Structural signals (link stuffing, exact duplicates, disposable inboxes)
 *     carry the weight. They describe how the message was SENT.
 *   - Lexical signals (keywords, ALL CAPS) are weak and can never alone reach
 *     the hide threshold. They describe how it was WORDED, which is exactly
 *     where a frustrated human resembles a bot.
 *
 * Every signal returns a reason code alongside its weight, stored in
 * `spam_reasons`, so a moderator sees WHY something was flagged rather than an
 * unexplainable verdict.
 */

/** Hide at/above this: quarantined, invisible publicly, waiting for review. */
const HIDE_THRESHOLD = Number(process.env.SPAM_SCORE_HIDE) || 12;
/** Flag at/above this: still PUBLISHED, but surfaced in the review queue. */
const FLAG_THRESHOLD = Number(process.env.SPAM_SCORE_FLAG) || 6;

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
/** Non-global twin, so `.test()` can't carry `lastIndex` state between calls. */
const URL_TEST_RE = /https?:\/\/[^\s<>"')]+/i;

/**
 * Latin scripts we ship in (Basic Latin, Latin-1 Supplement, Latin Extended-A/B)
 * plus General Punctuation. Written as explicit escapes rather than literal
 * characters so the source stays plain ASCII and reviewable in a diff.
 */
const LATIN_RANGE_RE = /[ -ɏ -⁯]/g;

/**
 * High-confidence commercial-spam phrases. Kept small and unambiguous: each one
 * is something a real feedback post is very unlikely to contain. Single generic
 * words ("free", "money", "offer", "cheap") are deliberately absent — they occur
 * constantly in genuine feature requests ("please offer a free tier").
 */
const SPAM_PHRASES = [
  "buy now",
  "click here now",
  "make money fast",
  "work from home",
  "casino",
  "porn",
  "viagra",
  "cialis",
  "payday loan",
  "forex trading",
  "binary options",
  "crypto giveaway",
  "bitcoin doubler",
  "seo services",
  "backlinks",
  "cheap rolex",
  "replica watches",
  "escort service",
  "hot singles",
  "weight loss pills",
  "limited time offer",
  "act now",
  "100% free",
  "risk free",
  "no credit check",
];

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

/** Normalized text for duplicate comparison: case/punctuation/spacing-insensitive. */
function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Share of letters that are uppercase, ignoring non-letters. */
function capsRatio(text) {
  const letters = String(text || "").replace(/[^a-zA-Z]/g, "");
  if (letters.length < 12) return 0; // too short to be meaningful ("BUG:", "API")
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length;
}

/** Longest run of one repeated character ("!!!!!!!!!!", "aaaaaaaaaa"). */
function longestRepeatRun(text) {
  const s = String(text || "");
  let best = 0;
  let run = 1;
  for (let i = 1; i < s.length; i += 1) {
    if (s[i] === s[i - 1]) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

/**
 * Share of characters outside the Latin ranges above. Catches homoglyph and
 * Cyrillic-substitution spam.
 *
 * IMPORTANT: this cannot be a strong signal. FeedBoard ships in 8 languages and
 * accepts feedback in any script — legitimate Greek, Japanese or Arabic feedback
 * trips it. Low weight, and it exists mainly to nudge borderline cases that
 * already look bad for other reasons.
 */
function nonLatinRatio(text) {
  const s = String(text || "").replace(/\s/g, "");
  if (s.length < 20) return 0;
  const nonLatin = s.replace(LATIN_RANGE_RE, "").length;
  return nonLatin / s.length;
}

/**
 * Score one submission.
 *
 * @param {object} input
 * @param {string} [input.title]
 * @param {string} [input.body]
 * @param {boolean} [input.isDisposableEmail]
 * @param {boolean} [input.emailHasNoMx]   true ONLY when the domain resolved and
 *                                         had no MX — never for an inconclusive
 *                                         DNS result (see emailQuality.js)
 * @param {string|null} [input.formTokenReason] reason code from verifyFormToken,
 *                                         null when the token was valid
 * @param {number} [input.duplicateCount]  recent near-identical submissions from
 *                                         the same tenant
 * @returns {{ score: number, reasons: string[] }}
 */
function spamScore(input = {}) {
  const title = String(input.title || "");
  const body = String(input.body || "");
  const text = `${title}\n${body}`;
  const reasons = [];
  let score = 0;

  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };

  // ---- Structural signals (heavy) ------------------------------------------

  // Link stuffing. One link is normal ("here's a screenshot", "see this docs
  // page"); three or more in anonymous feedback is the signature of SEO spam.
  const urls = text.match(URL_RE) || [];
  if (urls.length >= 5) add(8, "many_links");
  else if (urls.length >= 3) add(5, "several_links");

  // Distinct domains matter more than raw count — a spammer promotes several
  // sites, whereas a real user links the same doc twice.
  if (urls.length >= 2) {
    const hosts = new Set(
      urls.map((u) => {
        try {
          return new URL(u).host.toLowerCase();
        } catch {
          return u.toLowerCase();
        }
      })
    );
    if (hosts.size >= 3) add(4, "multiple_link_domains");
  }

  // A link in the TITLE is close to definitive — no genuine feedback title
  // contains a URL.
  if (URL_TEST_RE.test(title)) add(5, "link_in_title");

  // Repeat submission of the same content.
  const dupes = Number(input.duplicateCount) || 0;
  if (dupes >= 3) add(9, "repeat_duplicate");
  else if (dupes >= 1) add(5, "duplicate");

  if (input.isDisposableEmail) add(5, "disposable_email");
  if (input.emailHasNoMx) add(4, "email_domain_no_mx");

  // ---- Provenance signals (medium) -----------------------------------------

  switch (input.formTokenReason) {
    case null:
    case undefined:
      break; // valid token
    case "too_fast":
      // Submitted implausibly soon after the page loaded.
      add(6, "submitted_too_fast");
      break;
    case "bad_signature":
    case "malformed":
      // Forged rather than absent — worse than simply not having one.
      add(6, "invalid_form_token");
      break;
    case "expired":
      add(2, "stale_form_token");
      break;
    case "missing":
      // Direct API use. Legitimate for integrations, so weighted so it can never
      // reach the hide threshold on its own.
      add(3, "no_form_token");
      break;
    default:
      add(3, "no_form_token");
  }

  // ---- Lexical signals (light) ---------------------------------------------

  const haystack = text.toLowerCase();
  const phraseHits = SPAM_PHRASES.filter((p) => haystack.includes(p));
  if (phraseHits.length >= 3) add(6, "spam_phrases");
  else if (phraseHits.length === 2) add(4, "spam_phrases");
  else if (phraseHits.length === 1) add(2, "spam_phrase");

  // Shouting. Real users shout when they're angry, so this is intentionally
  // near-worthless alone.
  if (capsRatio(text) > 0.8) add(2, "all_caps");

  if (longestRepeatRun(text) >= 15) add(2, "repeated_characters");

  if (nonLatinRatio(text) > 0.6) add(2, "mostly_non_latin");

  // Body is just the title again — typical of generated filler. Only counts when
  // there IS a body; an empty description is perfectly normal.
  const nt = normalizeForCompare(title);
  const nb = normalizeForCompare(body);
  if (nt && nb && nt === nb) add(2, "body_repeats_title");

  return { score: clamp255(score), reasons };
}

/**
 * Map a score to what should happen to the submission.
 *
 * NOTE there are only two outcomes here. A FLAGGED submission (score at/above
 * FLAG_THRESHOLD but below HIDE_THRESHOLD) stays **published** — it is surfaced
 * in the review queue by its score, not by being hidden. Auto-hiding the middle
 * band would make every false positive invisible to the person it was meant for,
 * which is the failure mode this whole design is trying to avoid.
 *
 * The 'pending' state exists in the enum for MANUAL moderator use (park
 * something without deleting it); nothing assigns it automatically.
 *
 * @returns {'published'|'spam'}
 */
function moderationStateFor(score) {
  return score >= HIDE_THRESHOLD ? "spam" : "published";
}

/** Should this land in the owner's review queue (without being hidden)? */
function isFlagged(score) {
  return score >= FLAG_THRESHOLD;
}

module.exports = {
  spamScore,
  moderationStateFor,
  isFlagged,
  normalizeForCompare,
  HIDE_THRESHOLD,
  FLAG_THRESHOLD,
};
