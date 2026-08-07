const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * Reclassify a COMMENT on the spam axis — the counterpart to
 * updatePostModeration, and the thing that makes quarantining a comment
 * defensible at all.
 *
 * Without this, a comment scored as spam was hidden from the public board with
 * no way back: the dashboard thread rendered it looking perfectly normal, so
 * nobody could even tell it had been suppressed. A silent, unrecoverable
 * suppression is a worse failure than the spam it was preventing.
 *
 * Owner-only (comment moderation is already an owner action — see
 * deleteComment) but NOT plan-gated: clearing our own false positive must not
 * require an upgrade.
 *
 * @param {number} id
 * @param {'published'|'pending'|'spam'} state
 * @param {object} authData
 */
const VALID_STATES = new Set(["published", "pending", "spam"]);

const updateCommentModeration = async (id, state, authData) => {
  const { tenantId, role, lg } = authData;

  if (role !== "owner") {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.FORBIDDEN, "insufficient_permissions", lg)
    );
  }
  if (!VALID_STATES.has(state)) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_status", lg)
    );
  }

  // Publishing clears the score so the comment stops reading as suspect;
  // spam_reviewed_* keeps the original score for calibration (scripts/spam-report.js).
  const _query =
    state === "published"
      ? `UPDATE comments
            SET moderation_state = 'published',
                spam_reviewed_at = NOW(),
                spam_reviewed_score = CASE WHEN spam_reviewed_score IS NULL
                                           THEN spam_score ELSE spam_reviewed_score END,
                spam_score = 0,
                spam_reasons = NULL
          WHERE id = ? AND tenant_id = ?`
      : `UPDATE comments SET moderation_state = ? WHERE id = ? AND tenant_id = ?`;
  const params = state === "published" ? [id, tenantId] : [state, id, tenantId];

  try {
    const [result] = await pool.query(_query, params);
    if (result.affectedRows === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "comment_not_found", lg)
      );
    }
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "comment_updated_successfully", lg)
    );
  } catch (error) {
    console.error("Error updating comment moderation:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_update_comment",
        lg
      )
    );
  }
};

module.exports = { updateCommentModeration };
