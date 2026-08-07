/**
 * Calibrate the spam thresholds against REAL traffic.
 *
 *   node scripts/spam-report.js            # last 30 days, all tenants
 *   node scripts/spam-report.js --days 7
 *   node scripts/spam-report.js --tenant 3
 *
 * WHY THIS EXISTS. The scorer's weights were chosen by judgement, and the
 * rollout advice ("set SPAM_SCORE_HIDE high, watch, then lower it") is useless
 * without something to watch WITH. This is that something.
 *
 * It answers the three questions you actually need before tightening a
 * threshold:
 *
 *   1. What does the score distribution look like on this board? A threshold is
 *      only meaningful relative to the scores real submissions produce.
 *   2. What would each candidate threshold hide? Shown as counts, so you can see
 *      the cliff before you walk off it.
 *   3. How often are we WRONG? Every "Not spam" click is a human labelling a
 *      false positive, preserved in spam_reviewed_score. That is ground truth,
 *      not a guess — and it is the number that should decide the threshold.
 *
 * Read-only. Safe to run against production.
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");
const {
  HIDE_THRESHOLD,
  FLAG_THRESHOLD,
} = require("../src/common/spamScore");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const DAYS = Number(arg("days", 30));
const TENANT = arg("tenant", null);

const bar = (n, max, width = 40) => {
  if (max <= 0) return "";
  return "#".repeat(Math.max(n > 0 ? 1 : 0, Math.round((n / max) * width)));
};

const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");

(async () => {
  const where = ["created_at > (NOW() - INTERVAL ? DAY)", "author_id IS NULL"];
  const params = [DAYS];
  if (TENANT) {
    where.push("tenant_id = ?");
    params.push(Number(TENANT));
  }
  const W = `WHERE ${where.join(" AND ")}`;

  console.log(
    `\nSpam report — last ${DAYS} day(s)${TENANT ? `, tenant ${TENANT}` : ", all tenants"}`
  );
  console.log(
    `Active thresholds:  flag >= ${FLAG_THRESHOLD}   hide >= ${HIDE_THRESHOLD}\n`
  );

  for (const table of ["posts", "comments"]) {
    const [rows] = await pool.query(
      `SELECT spam_score AS score, COUNT(*) AS n FROM ${table} ${W}
        GROUP BY spam_score ORDER BY spam_score ASC`,
      params
    );
    const total = rows.reduce((a, r) => a + r.n, 0);

    console.log(`── ${table.toUpperCase()} (${total} guest submissions) ───────────`);
    if (total === 0) {
      console.log("   no guest submissions in this window\n");
      continue;
    }

    const max = Math.max(...rows.map((r) => r.n));
    for (const r of rows) {
      const marker =
        r.score >= HIDE_THRESHOLD ? " HIDDEN" : r.score >= FLAG_THRESHOLD ? " flagged" : "";
      console.log(
        `   score ${String(r.score).padStart(3)} │ ${String(r.n).padStart(5)} ${bar(r.n, max)}${marker}`
      );
    }

    // What each candidate threshold would cost. The interesting column is how
    // many CLEAN-looking submissions get swept up as you tighten.
    console.log("\n   If SPAM_SCORE_HIDE were set to…");
    const candidates = [...new Set(rows.map((r) => r.score))]
      .filter((s) => s > 0)
      .sort((a, b) => a - b);
    for (const c of candidates) {
      const hidden = rows.filter((r) => r.score >= c).reduce((a, r) => a + r.n, 0);
      console.log(
        `     >= ${String(c).padStart(3)}  hides ${String(hidden).padStart(5)} of ${total}  (${pct(hidden, total)})${
          c === HIDE_THRESHOLD ? "   <— current" : ""
        }`
      );
    }

    // Ground truth: what humans overruled.
    const [[review]] = await pool.query(
      `SELECT COUNT(*) AS reviewed,
              AVG(spam_reviewed_score) AS avg_score,
              MAX(spam_reviewed_score) AS max_score,
              SUM(spam_reviewed_score >= ?) AS was_hidden
         FROM ${table}
        WHERE spam_reviewed_at IS NOT NULL
          AND spam_reviewed_at > (NOW() - INTERVAL ? DAY)
          ${TENANT ? "AND tenant_id = ?" : ""}`,
      TENANT ? [HIDE_THRESHOLD, DAYS, Number(TENANT)] : [HIDE_THRESHOLD, DAYS]
    );

    console.log("\n   Moderator overrides (ground truth — humans said we were wrong):");
    if (!review.reviewed) {
      console.log("     none yet — nothing has been marked \"Not spam\".");
      console.log("     Until this has data, treat every threshold below as unvalidated.");
    } else {
      console.log(`     ${review.reviewed} item(s) marked not-spam`);
      console.log(
        `     their scores: avg ${Number(review.avg_score).toFixed(1)}, max ${review.max_score}`
      );
      console.log(
        `     ${review.was_hidden} of them had been HIDDEN (score >= ${HIDE_THRESHOLD}) — real false positives`
      );
      if (review.was_hidden > 0) {
        console.log(
          `     ACTION: raise SPAM_SCORE_HIDE above ${review.max_score} to stop hiding this kind of submission.`
        );
      } else {
        console.log(
          `     No hidden item has been overturned — the hide threshold is not eating real feedback.`
        );
      }
    }

    // Which signals actually fire. A reason that never appears is dead weight;
    // one that fires on everything is not discriminating.
    const [reasonRows] = await pool.query(
      `SELECT spam_reasons FROM ${table} ${W} AND spam_reasons IS NOT NULL`,
      params
    );
    const freq = new Map();
    for (const r of reasonRows) {
      try {
        for (const code of JSON.parse(r.spam_reasons) || []) {
          freq.set(code, (freq.get(code) || 0) + 1);
        }
      } catch {
        /* skip malformed */
      }
    }
    if (freq.size) {
      console.log("\n   Signals fired:");
      [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([code, n]) =>
          console.log(`     ${String(n).padStart(5)}  ${code}`)
        );
    }
    console.log("");
  }

  const [[queue]] = await pool.query(
    `SELECT SUM(moderation_state = 'spam') AS quarantined,
            SUM(moderation_state <> 'spam' AND spam_score >= ?) AS flagged
       FROM posts ${TENANT ? "WHERE tenant_id = ?" : ""}`,
    TENANT ? [FLAG_THRESHOLD, Number(TENANT)] : [FLAG_THRESHOLD]
  );
  console.log(
    `Queue right now: ${Number(queue.quarantined) || 0} quarantined, ${Number(queue.flagged) || 0} flagged for review\n`
  );

  await pool.end();
})().catch((e) => {
  console.error("report error:", e.message);
  process.exit(1);
});
