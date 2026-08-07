const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * Reclassify a post on the SPAM axis — the human override for the automatic
 * scorer.
 *
 * This is what makes automatic quarantine acceptable at all: a false positive is
 * recoverable in one click rather than being silently lost. Marking something
 * "not spam" also zeroes `spam_score`/`spam_reasons`, so it leaves the review
 * queue for good instead of reappearing on every visit.
 *
 * Deliberately separate from updatePostStatus: `status` is the pipeline
 * (open → planned → completed) and syncs to the roadmap, while this axis only
 * controls public visibility. Merging them would let a roadmap move silently
 * unhide spam.
 *
 * @param {number} id
 * @param {'published'|'pending'|'spam'} state
 * @param {object} authData
 */
const VALID_STATES = new Set(["published", "pending", "spam"]);

const updatePostModeration = async (id, state, authData) => {
  const { tenantId, lg } = authData;

  if (!VALID_STATES.has(state)) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_status", lg)
    );
  }

  // Clearing the score on "not spam" is what removes it from the queue — the
  // queue matches on score as well as state, so leaving the score set would keep
  // showing an item the owner has already judged.
  //
  // But that clear would also destroy the one number worth keeping: a human just
  // told us the classifier was WRONG at that score. `spam_reviewed_*` preserves
  // it so scripts/spam-report.js can compute a real false-positive rate per band
  // — the difference between tuning thresholds from evidence and from intuition.
  // Guarded with CASE so re-reviewing an item keeps the FIRST score (the one the
  // classifier actually produced), not 0 from a second pass.
  const _query =
    state === "published"
      ? `UPDATE posts
            SET moderation_state = 'published',
                spam_reviewed_at = NOW(),
                spam_reviewed_score = CASE WHEN spam_reviewed_score IS NULL
                                           THEN spam_score ELSE spam_reviewed_score END,
                spam_score = 0,
                spam_reasons = NULL
          WHERE id = ? AND tenant_id = ?`
      : `UPDATE posts SET moderation_state = ? WHERE id = ? AND tenant_id = ?`;
  const params =
    state === "published" ? [id, tenantId] : [state, id, tenantId];

  try {
    const [result] = await pool.query(_query, params);
    if (result.affectedRows === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg)
      );
    }
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "post_status_updated_successfully", lg)
    );
  } catch (error) {
    console.error("Error updating post moderation:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_update_post_status",
        lg
      )
    );
  }
};

module.exports = { updatePostModeration };
