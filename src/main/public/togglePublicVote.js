const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { voterHash } = require("../../common/guestIdentity");

/**
 * @description Toggle an anonymous (guest) upvote on a public post.
 *
 * DEDUP IDENTITY. This used to key solely on `guest_id` — a value the CLIENT
 * sends. `UNIQUE (tenant_id, post_id, guest_id)` therefore stopped an honest
 * browser and nothing else: a bot posting a fresh UUID each time voted without
 * limit, which made the vote counts (the whole point of the board) forgeable.
 *
 * Votes are now deduped on `voter_hash`, an HMAC of the client IP derived
 * server-side (src/common/guestIdentity.js) and backed by
 * `UNIQUE (tenant_id, post_id, voter_hash)`. `guest_id` is still stored so the
 * visitor's own filled/unfilled UI state keeps working, but it no longer decides
 * anything.
 *
 * The trade-off is deliberate and worth stating: everyone behind one NAT (an
 * office, a household, a campus) now shares a vote on a given post. For a
 * product-feedback board — where the count is a rough demand signal, not an
 * election — under-counting a shared network is much cheaper than letting one
 * script manufacture arbitrary demand.
 *
 * @param {number} tenantId resolved from the portal subdomain
 * @param {number} postId
 * @param {string} guestId opaque per-browser identifier (display/UI state only)
 * @param {string} lg
 * @param {import("express").Request} req
 * @returns {{ voted: boolean, voteCount: number }}
 */
const togglePublicVote = async (tenantId, postId, guestId, lg, req) => {
  const guest = (guestId || "").trim();
  if (!guest || guest.length > 64) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "guest_id_required", lg)
    );
  }

  const hash = voterHash(req);

  try {
    const [posts] = await pool.query(
      "SELECT id, moderation_state FROM posts WHERE id = ? AND tenant_id = ?",
      [postId, tenantId]
    );
    // Quarantined posts aren't publicly visible, so they can't be voted on.
    if (posts.length === 0 || posts[0].moderation_state === "spam") {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg)
      );
    }

    // Match on the trusted identity when we have one, falling back to guest_id
    // only when no IP could be derived (see guestIdentity.voterHash).
    const [existing] = hash
      ? await pool.query(
          "SELECT id FROM votes WHERE tenant_id = ? AND post_id = ? AND voter_hash = ?",
          [tenantId, postId, hash]
        )
      : await pool.query(
          "SELECT id FROM votes WHERE tenant_id = ? AND post_id = ? AND guest_id = ?",
          [tenantId, postId, guest]
        );

    let voted;
    if (existing.length > 0) {
      await pool.query("DELETE FROM votes WHERE id = ?", [existing[0].id]);
      voted = false;
    } else {
      // INSERT IGNORE so a duplicate (race / stale client) can't error out — and
      // so a bot racing the uniqueness check simply gets no extra vote.
      const [res] = await pool.query(
        `INSERT IGNORE INTO votes (tenant_id, post_id, user_id, guest_id, voter_hash, vote_type)
         VALUES (?, ?, NULL, ?, ?, 'upvote')`,
        [tenantId, postId, guest, hash]
      );
      // affectedRows 0 means the unique constraint rejected it: this identity had
      // already voted under a different guest_id. Report the truthful state
      // rather than claiming a vote we did not record.
      voted = res.affectedRows > 0;
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
