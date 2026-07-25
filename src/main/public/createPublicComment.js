const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { notifyTeam } = require("../../common/notifications");
const { getTenantPlan } = require("../../common/planGuard");
const { getPlanLimits } = require("../../consts/plans");

/**
 * Resolve the plan-gated "owner identity" for a comment.
 *   - named  → 1  ("Name (Owner)" + tick)   requires ownerBadge   (Pro+)
 *   - hidden → 2  ("Owner" only + tick)      requires ownerPrivacy (Business)
 * Returns 0 (show as self) unless the author truly owns the board AND the plan
 * permits the requested mode.
 */
const resolveOwnerMode = async (mode, authUser, tenantId) => {
  if (
    !mode ||
    !authUser?.id ||
    authUser.role !== "owner" ||
    Number(authUser.tenantId) !== Number(tenantId)
  ) {
    return 0;
  }
  const limits = getPlanLimits(await getTenantPlan(tenantId));
  if (mode === "hidden" && limits.ownerPrivacy) return 2;
  if (mode === "named" && limits.ownerBadge) return 1;
  return 0;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const truncate = (s, n) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/**
 * @description Add a comment to a post from the PUBLIC portal. If `authUser` is
 * set (a logged-in viewer), the comment is attributed to that user (author_id);
 * otherwise it's a guest comment (author_id NULL + optional submitter name/email).
 * Supports threaded replies via `parentCommentId`.
 * @param {number} tenantId resolved from the portal subdomain
 * @param {number} postId
 * @param {object} data { body, parentCommentId, submitterName, submitterEmail }
 * @param {object|null} authUser req.auth when logged in, else null
 * @param {string} lg
 */
const createPublicComment = async (tenantId, postId, data, authUser, lg) => {
  const body = (data?.body || "").trim();
  const authorId = authUser?.id || null;
  // Logged-in comments carry no guest name/email — the identity is the user.
  const submitterName = authorId
    ? null
    : (data?.submitterName || "").trim().slice(0, 120) || null;
  const submitterEmail = authorId
    ? null
    : (data?.submitterEmail || "").trim().slice(0, 255) || null;
  // Persistent per-browser id for guests, so all of one guest's comments can be
  // given a single stable pseudonymous identity (name + colour) on the portal.
  const guestId = authorId
    ? null
    : (data?.guestId || "").toString().trim().slice(0, 64) || null;
  const parentCommentId = data?.parentCommentId || null;

  if (!body) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "comment_body_required", lg)
    );
  }
  if (submitterEmail && !EMAIL_RE.test(submitterEmail)) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email", lg)
    );
  }

  try {
    const [posts] = await pool.query(
      "SELECT id, title FROM posts WHERE id = ? AND tenant_id = ?",
      [postId, tenantId]
    );
    if (posts.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "post_not_found", lg)
      );
    }
    const postTitle = posts[0].title;

    // A reply must target a comment on this same post/tenant. Comments are kept
    // two levels deep: a reply always attaches to the TOP-LEVEL comment, so
    // replying to a reply joins that comment's flat thread (never nests deeper).
    let rootParentId = null;
    if (parentCommentId) {
      const [parent] = await pool.query(
        "SELECT id, parent_comment_id FROM comments WHERE id = ? AND post_id = ? AND tenant_id = ?",
        [parentCommentId, postId, tenantId]
      );
      if (parent.length === 0) {
        return Promise.reject(
          setServerResponse(API_STATUS_CODE.BAD_REQUEST, "comment_not_found", lg)
        );
      }
      let current = parent[0];
      const seen = new Set();
      while (current.parent_comment_id && !seen.has(current.id)) {
        seen.add(current.id);
        const [up] = await pool.query(
          "SELECT id, parent_comment_id FROM comments WHERE id = ? AND tenant_id = ?",
          [current.parent_comment_id, tenantId]
        );
        if (up.length === 0) break;
        current = up[0];
      }
      rootParentId = current.id;
    }

    const asOwner = await resolveOwnerMode(data?.ownerMode, authUser, tenantId);

    const [result] = await pool.query(
      `INSERT INTO comments
         (tenant_id, post_id, author_id, submitter_name, submitter_email, guest_id, as_owner, parent_comment_id, body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, postId, authorId, submitterName, submitterEmail, guestId, asOwner, rootParentId, body]
    );

    // In-app notification to the team (except the commenter, if a member).
    // Fire-and-forget — a notification failure must not fail the comment.
    const who = authUser?.fullName || submitterName || "Someone";
    notifyTeam(tenantId, {
      type: "comment_reply",
      // English fallback…
      title: `New comment on “${truncate(postTitle, 70)}”`,
      message: `${who}: “${truncate(body, 140)}”`,
      // …plus the structured pieces, so the client renders it in the reader's
      // language rather than the language it happened to be written in.
      meta: {
        key: "comment",
        postTitle: truncate(postTitle, 70),
        who,
        body: truncate(body, 140),
      },
      referenceType: "post",
      referenceId: postId,
      excludeUserId: authorId,
    }).catch(() => {});

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.CREATED,
        "comment_created_successfully",
        lg,
        { id: result.insertId }
      )
    );
  } catch (error) {
    console.error("Error creating public comment:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_create_comment",
        lg
      )
    );
  }
};

module.exports = { createPublicComment };
