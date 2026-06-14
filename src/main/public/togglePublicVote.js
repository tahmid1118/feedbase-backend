const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * @description Toggle an anonymous (guest) upvote on a public post. Spam is
 * limited by `guest_id` (a persistent per-browser cookie value): the unique
 * (tenant_id, post_id, guest_id) constraint means one vote per browser per post.
 * @param {number} tenantId resolved from the portal subdomain
 * @param {number} postId
 * @param {string} guestId opaque per-browser identifier
 * @param {string} lg
 * @returns {{ voted: boolean, voteCount: number }}
 */
const togglePublicVote = async (tenantId, postId, guestId, lg) => {
  const guest = (guestId || "").trim();
  if (!guest || guest.length > 64) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "guest_id_required", lg)
    );
  }

  try {
    const [posts] = await pool.query(
      "SELECT id FROM posts WHERE id = ? AND tenant_id = ?",
      [postId, tenantId]
    );
    if (posts.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg)
      );
    }

    const [existing] = await pool.query(
      "SELECT id FROM votes WHERE tenant_id = ? AND post_id = ? AND guest_id = ?",
      [tenantId, postId, guest]
    );

    let voted;
    if (existing.length > 0) {
      await pool.query("DELETE FROM votes WHERE id = ?", [existing[0].id]);
      voted = false;
    } else {
      // INSERT IGNORE so a duplicate (race / stale client) can't error out.
      await pool.query(
        `INSERT IGNORE INTO votes (tenant_id, post_id, user_id, guest_id, vote_type)
         VALUES (?, ?, NULL, ?, 'upvote')`,
        [tenantId, postId, guest]
      );
      voted = true;
    }

    const [[{ voteCount }]] = await pool.query(
      "SELECT COUNT(*) AS voteCount FROM votes WHERE post_id = ?",
      [postId]
    );

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        "vote_updated_successfully",
        lg,
        { voted, voteCount }
      )
    );
  } catch (error) {
    console.error("Error toggling public vote:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_update_vote",
        lg
      )
    );
  }
};

module.exports = { togglePublicVote };
