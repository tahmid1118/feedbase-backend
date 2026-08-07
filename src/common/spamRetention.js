const { pool } = require("../../database/dbPool");

/**
 * Drop quarantined spam once it is old enough to be beyond dispute.
 *
 * WHY THIS EXISTS. The review queue is opt-in: plenty of boards will never have
 * anyone look at it. Without retention, quarantined rows accumulate forever —
 * `posts` grows unbounded, and the queue becomes so noisy that the one real
 * false positive in it is impossible to spot. Both failures make the feature
 * worse the longer it runs.
 *
 * WHY 30 DAYS. Long enough that a false positive is recoverable for a month
 * (far longer than anyone waits to notice their feedback vanished), short
 * enough that the table stays small. A shorter window would start destroying
 * recoverable mistakes; a longer one buys nothing.
 *
 * ONLY `moderation_state = 'spam'`. Flagged-but-published posts are real
 * feedback and are never touched by retention.
 */

const RETENTION_DAYS = Number(process.env.SPAM_RETENTION_DAYS) || 30;

/** Disable entirely with SPAM_RETENTION_DAYS=0. */
const isEnabled = () => RETENTION_DAYS > 0;

async function purgeExpiredSpam() {
  if (!isEnabled()) return { posts: 0, comments: 0 };
  try {
    const [posts] = await pool.query(
      `DELETE FROM posts
        WHERE moderation_state = 'spam'
          AND created_at < (NOW() - INTERVAL ? DAY)`,
      [RETENTION_DAYS]
    );
    const [comments] = await pool.query(
      `DELETE FROM comments
        WHERE moderation_state = 'spam'
          AND created_at < (NOW() - INTERVAL ? DAY)`,
      [RETENTION_DAYS]
    );
    const removed = {
      posts: posts.affectedRows,
      comments: comments.affectedRows,
    };
    if (removed.posts || removed.comments) {
      console.log(
        `spam retention: removed ${removed.posts} post(s), ${removed.comments} comment(s) older than ${RETENTION_DAYS}d`
      );
    }
    return removed;
  } catch (error) {
    // Housekeeping must never take the server down or fail a request.
    console.error("spam retention error:", error.message);
    return { posts: 0, comments: 0 };
  }
}

/**
 * Opportunistic trigger, at most once an hour per process.
 *
 * Deliberately NOT a setInterval or a cron: PM2 runs one worker per core, so a
 * timer would fire N times concurrently. Gating on elapsed time means the work
 * happens during normal traffic, and a duplicate run is harmless anyway (the
 * DELETE is idempotent — the second one matches nothing).
 */
const MIN_INTERVAL_MS = 60 * 60 * 1000;
let lastRun = 0;

function maybePurgeExpiredSpam() {
  if (!isEnabled()) return;
  const now = Date.now();
  if (now - lastRun < MIN_INTERVAL_MS) return;
  lastRun = now;
  purgeExpiredSpam().catch(() => {});
}

module.exports = { purgeExpiredSpam, maybePurgeExpiredSpam, RETENTION_DAYS };
