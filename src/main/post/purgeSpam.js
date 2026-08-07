const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * Delete spam-quarantined posts.
 *
 * TWO SAFETY RULES, both load-bearing:
 *
 * 1. **Only `moderation_state = 'spam'` rows are ever touched.** Flagged-but-
 *    published posts (score above the flag threshold, below the hide threshold)
 *    appear in the same review queue but are REAL feedback that happens to look
 *    suspicious. A bulk delete that swept those up is precisely how a customer's
 *    complaint gets destroyed, so the SQL — not the UI — excludes them.
 *
 * 2. **Owner-only, but NOT plan-gated.** Deleting ordinary feedback requires
 *    Pro (`deleteFeedback`), because that is the team choosing to discard a
 *    user's words. Spam is not the user's words and it is not the customer's
 *    fault — it is our filter's output. Charging someone to clean up our false
 *    alarms would be indefensible, so this deliberately skips `planAllows`.
 *
 * @param {object} authData
 * @param {number[]|undefined} ids  specific posts, or undefined for "all
 *                                  quarantined older than olderThanDays"
 * @param {number|undefined} olderThanDays
 */
const purgeSpamPosts = async (authData, ids, olderThanDays) => {
  const { tenantId, role, lg } = authData;

  if (role !== "owner") {
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.FORBIDDEN,
        "delete_feedback_owner_only",
        lg
      )
    );
  }

  const list = Array.isArray(ids)
    ? ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    : null;

  if (list && list.length === 0) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_request", lg)
    );
  }

  // `moderation_state = 'spam'` is non-negotiable in both branches.
  let where = "WHERE tenant_id = ? AND moderation_state = 'spam'";
  const params = [tenantId];

  if (list) {
    where += ` AND id IN (${list.map(() => "?").join(",")})`;
    params.push(...list);
  } else {
    const days = Number(olderThanDays);
    // Require an explicit, sane window rather than defaulting to "everything" —
    // a missing parameter must never mean "delete the whole queue".
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_request", lg)
      );
    }
    where += " AND created_at < (NOW() - INTERVAL ? DAY)";
    params.push(days);
  }

  try {
    const [result] = await pool.query(`DELETE FROM posts ${where}`, params);
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "post_deleted_successfully", lg, {
        deleted: result.affectedRows,
      })
    );
  } catch (error) {
    console.error("Error purging spam posts:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_delete_post",
        lg
      )
    );
  }
};

module.exports = { purgeSpamPosts };
