/**
 * Weight calibration for src/common/spamScore.js.
 *
 *   node --test test/
 *
 * Uses the built-in node:test runner — no new dependency, and no framework
 * imposed on a project that has none.
 *
 * WHY THESE TESTS EXIST. The scorer's weights are the only guessed part of the
 * spam system, and the expensive failure is a FALSE POSITIVE: quarantining a
 * real customer's complaint is worse than letting a casino link sit on the board
 * for an hour. The "legitimate feedback" block below is therefore the important
 * half of this file — it pins down the cases that must never be auto-hidden,
 * including rude, shouty, and non-English feedback.
 */
const test = require("node:test");
const assert = require("node:assert");

const {
  spamScore,
  moderationStateFor,
  isFlagged,
  HIDE_THRESHOLD,
  FLAG_THRESHOLD,
} = require("../src/common/spamScore");

/** A submission that came through the real UI has a valid token. */
const viaUi = (over = {}) => ({ formTokenReason: null, ...over });

// ---------------------------------------------------------------------------
// Legitimate feedback must never be auto-hidden.
// ---------------------------------------------------------------------------

test("ordinary feature request scores zero", () => {
  const { score } = spamScore(
    viaUi({
      title: "Add dark mode",
      body: "The app is painful to use at night. A dark theme would help a lot.",
    })
  );
  assert.strictEqual(score, 0);
  assert.strictEqual(moderationStateFor(score), "published");
});

test("angry feedback using the word 'scam' is not hidden", () => {
  // The single lexical hit must stay far below both thresholds — a frustrated
  // customer is the most costly possible false positive.
  const { score } = spamScore(
    viaUi({
      title: "Pricing is misleading",
      body: "Charging me after I cancelled is a scam. Support ignored two emails.",
    })
  );
  assert.ok(score < FLAG_THRESHOLD, `expected < ${FLAG_THRESHOLD}, got ${score}`);
  assert.strictEqual(moderationStateFor(score), "published");
});

test("ALL CAPS bug report is not hidden", () => {
  const { score } = spamScore(
    viaUi({
      title: "NOTHING WORKS",
      body: "I CANNOT LOG IN AND I HAVE BEEN LOCKED OUT ALL MORNING PLEASE FIX",
    })
  );
  assert.ok(score < HIDE_THRESHOLD, `expected < ${HIDE_THRESHOLD}, got ${score}`);
});

test("bug report containing one reproduction link is not hidden", () => {
  const { score } = spamScore(
    viaUi({
      title: "Crash on upload",
      body: "Reproduced here: https://example.com/repro — happens every time.",
    })
  );
  assert.ok(score < FLAG_THRESHOLD, `expected < ${FLAG_THRESHOLD}, got ${score}`);
});

test("non-English feedback in a Latin script scores zero", () => {
  // Latin Extended-A (Polish diacritics) must not read as suspicious — we ship
  // in 8 languages and most portal visitors will not be writing English.
  const { score } = spamScore(
    viaUi({
      title: "Prosze dodac tryb ciemny",
      body: "Aplikacja jest zbyt jasna w nocy. Zazolc gesla jazn, prosze o poprawke.",
    })
  );
  assert.strictEqual(score, 0);
});

test("submission from a non-browser API client is flagged but never hidden", () => {
  // No form token at all. Worth surfacing, not worth suppressing on its own.
  const { score, reasons } = spamScore({
    title: "Integration posted this",
    body: "Filed automatically from our internal tool.",
    formTokenReason: "missing",
  });
  assert.ok(reasons.includes("no_form_token"));
  assert.ok(score < HIDE_THRESHOLD, `expected < ${HIDE_THRESHOLD}, got ${score}`);
});

// ---------------------------------------------------------------------------
// Actual spam must be caught.
// ---------------------------------------------------------------------------

test("link-stuffed SEO spam is hidden", () => {
  const { score, reasons } = spamScore({
    title: "Cheap rolex replica watches",
    body: [
      "buy now https://spam1.example/a",
      "https://spam2.example/b",
      "https://spam3.example/c",
      "https://spam4.example/d",
      "https://spam5.example/e",
    ].join(" "),
    formTokenReason: "missing",
  });
  assert.ok(reasons.includes("many_links"));
  assert.strictEqual(moderationStateFor(score), "spam");
});

test("a URL in the title plus a throwaway inbox is hidden", () => {
  const { score } = spamScore({
    title: "Visit https://spam.example now",
    body: "make money fast working from home",
    isDisposableEmail: true,
    formTokenReason: "missing",
  });
  assert.strictEqual(moderationStateFor(score), "spam");
});

test("instant submission after page load is flagged", () => {
  // A human cannot read a board and write feedback in under three seconds.
  const { score, reasons } = spamScore({
    title: "Great site",
    body: "Nice work, check out my page.",
    formTokenReason: "too_fast",
  });
  assert.ok(reasons.includes("submitted_too_fast"));
  assert.ok(isFlagged(score), `expected flagged, got ${score}`);
});

test("repeated duplicate submissions escalate to hidden", () => {
  const once = spamScore(viaUi({ title: "Buy now", body: "casino", duplicateCount: 1 }));
  const many = spamScore(viaUi({ title: "Buy now", body: "casino", duplicateCount: 4 }));
  assert.ok(many.score > once.score, "more duplicates must score higher");
  assert.strictEqual(moderationStateFor(many.score), "spam");
});

test("a forged form token outweighs a missing one", () => {
  const missing = spamScore({ title: "x", body: "y", formTokenReason: "missing" });
  const forged = spamScore({ title: "x", body: "y", formTokenReason: "bad_signature" });
  assert.ok(
    forged.score > missing.score,
    "forging a token is stronger evidence than not having one"
  );
});

// ---------------------------------------------------------------------------
// Invariants.
// ---------------------------------------------------------------------------

test("no single lexical signal can reach the hide threshold", () => {
  // The whole design bias: wording alone must never quarantine anything, because
  // that is where genuine angry feedback and spam look alike.
  for (const body of ["casino", "buy now", "AAAAAAAAAAAAAAAAAAAAAAAA"]) {
    const { score } = spamScore(viaUi({ title: "Feedback", body }));
    assert.ok(
      score < HIDE_THRESHOLD,
      `"${body}" alone reached the hide threshold (${score})`
    );
  }
});

test("score is clamped into the TINYINT UNSIGNED column range", () => {
  const { score } = spamScore({
    title: "https://a.example buy now casino porn viagra",
    body: Array.from({ length: 40 }, (_, i) => `https://s${i}.example/x`).join(" "),
    isDisposableEmail: true,
    emailHasNoMx: true,
    duplicateCount: 99,
    formTokenReason: "bad_signature",
  });
  assert.ok(score >= 0 && score <= 255, `score ${score} outside TINYINT range`);
});

test("thresholds are ordered", () => {
  assert.ok(
    FLAG_THRESHOLD < HIDE_THRESHOLD,
    "flag threshold must be below hide threshold or the flagged band vanishes"
  );
});
