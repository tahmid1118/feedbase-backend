const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { notifyTeam } = require("../../common/notifications");
const { getTenantPlan } = require("../../common/planGuard");
const { getPlanLimits } = require("../../consts/plans");
const { evaluatePublicWrite } = require("../../common/publicWriteGuard");
const { normalizeForCompare } = require("../../common/spamScore");

/**
 * Resolve the display IDENTITY for a board owner's comment.
 *
 * Commenting is free on every plan — what a paid plan buys is the identity the
 * comment is shown under, not the right to speak:
 *   - 1 "Name (Owner)" + owner tick → needs `ownerBadge` (Pro+)
 *   - 2 "Owner", real name withheld → needs `ownerPrivacy` (Business)
 *   - 0 plain name — always available, and what an unentitled request FALLS
 *     BACK to. Asking for a mode the plan doesn't cover downgrades the badge
 *     rather than rejecting the comment, so nobody loses what they typed to a
 *     paywall.
 * A non-owner author is never gated here (they comment as a normal user).
 */
const resolveOwner = async (mode, authUser, tenantId) => {
  const isBoardOwner =
    authUser?.id &&
    authUser.role === "owner" &&
    Number(authUser.tenantId) === Number(tenantId);
  if (!isBoardOwner || (mode !== "named" && mode !== "hidden")) return { asOwner: 0 };

  const limits = getPlanLimits(await getTenantPlan(tenantId));
  if (mode === "hidden" && limits.ownerPrivacy) return { asOwner: 2 };
  if (limits.ownerBadge) return { asOwner: 1 };
  return { asOwner: 0 };
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
const createPublicComment = async (tenantId, postId, data, authUser, lg, req) => {
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
      "SELECT id, title, moderation_state FROM posts WHERE id = ? AND tenant_id = ?",
      [postId, tenantId]
    );
    // A quarantined post is invisible publicly, so a request to comment on one
    // did not come from the board — treat it as not found rather than confirming
    // the id exists.
    if (posts.length === 0 || posts[0].moderation_state === "spam") {
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

    const { asOwner } = await resolveOwner(data?.ownerMode, authUser, tenantId);

    // ---- Spam evaluation (guests only) -------------------------------------
    // Same comment body posted repeatedly on this board is the classic comment
    // spam pattern. Best-effort, 24h window, this tenant only.
    let duplicateCount = 0;
    if (!authorId) {
      try {
        const normalized = normalizeForCompare(body);
        if (normalized) {
          const [dupes] = await pool.query(
            `SELECT COUNT(*) AS n FROM comments
              WHERE tenant_id = ?
                AND author_id IS NULL
                AND created_at > (NOW() - INTERVAL 24 HOUR)
                AND LOWER(body) LIKE ?`,
            [tenantId, `%${normalized.slice(0, 80)}%`]
          );
          duplicateCount = Number(dupes?.[0]?.n) || 0;
        }
      } catch {
        /* best effort */
      }
    }

    const guard = await evaluatePublicWrite({
      tenantId,
      req,
      data,
      body,
      email: submitterEmail,
      duplicateCount,
      isAuthenticated: Boolean(authorId),
    });

    // Honeypot: fake success, store nothing. See publicWriteGuard.
    if (guard.discard) {
      return Promise.resolve(
        setServerResponse(
          API_STATUS_CODE.CREATED,
          "comment_created_successfully",
          lg,
          { id: null }
        )
      );
    }

    if (guard.rateLimited) {
      return Promise.reject(
        setServerResponse(
          API_STATUS_CODE.TOO_MANY_REQUESTS,
          "too_many_requests",
          lg
        )
      );
    }

    const [result] = await pool.query(
      `INSERT INTO comments
         (tenant_id, post_id, author_id, submitter_name, submitter_email, guest_id, voter_hash,
          as_owner, parent_comment_id, body, moderation_state, spam_score, spam_reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        postId,
        authorId,
        submitterName,
        submitterEmail,
        guestId,
        guard.voterHash,
        asOwner,
        rootParentId,
        body,
        guard.moderationState,
        guard.score,
        guard.reasons.length ? JSON.stringify(guard.reasons) : null,
      ]
    );

    // Quarantined comments notify nobody — see the same note in createPublicPost.
    const quarantined = guard.moderationState === "spam";

    if (!quarantined) {
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
    }

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
