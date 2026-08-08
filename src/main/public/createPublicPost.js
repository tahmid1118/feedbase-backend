const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { notifyOwnerOfNewPost } = require("./notifyOwnerOfNewPost");
const { attachToPost } = require("../attachments/attachments");
const { notifyTeam } = require("../../common/notifications");
const { evaluatePublicWrite } = require("../../common/publicWriteGuard");
const { normalizeForCompare } = require("../../common/spamScore");
const { getTenantPlan } = require("../../common/planGuard");
const { getPlanLimits } = require("../../consts/plans");

const POST_TYPES = ["feedback", "feature_request", "bug_report"];
const TYPE_LABEL = {
  feedback: "feedback",
  feature_request: "a feature request",
  bug_report: "a bug report",
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const truncate = (s, n) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/**
 * @description Create a feedback post from the PUBLIC portal (no auth). The
 * author is a guest: `author_id` is NULL and the optional name/email are stored
 * on the post. New public submissions always start as `open`.
 * @param {number} tenantId resolved from the portal subdomain
 * @param {object} data { title, description, postType, submitterName, submitterEmail }
 * @param {string} lg
 */
/**
 * Posting on your own board is FREE, on every plan. Taking part in the
 * conversation is the product working, not an upsell — a board whose owner
 * cannot answer on it is a worse board, and gating that only pushed owners to
 * reply as an unattributed guest.
 *
 * What stays paid is the IDENTITY a post or comment is shown under: the
 * "Name (Owner)" badge is Pro+ (`ownerBadge`) and the name-withheld "Owner" is
 * Business (`ownerPrivacy`). A Free owner posts plainly as themselves.
 */
const createPublicPost = async (tenantId, data, authUser, lg, req) => {
  const title = (data?.title || "").trim();
  const description = (data?.description || "").trim();
  const postType = POST_TYPES.includes(data?.postType)
    ? data.postType
    : "feedback";
  const authorId = authUser?.id || null;
  // Logged-in submissions are owned by the user (no guest name/email).
  const submitterName = authorId
    ? null
    : (data?.submitterName || "").trim().slice(0, 120) || null;
  const submitterEmail = authorId
    ? null
    : (data?.submitterEmail || "").trim().slice(0, 255) || null;
  // Persistent per-browser id for guests → one stable pseudonymous identity.
  const guestId = authorId
    ? null
    : (data?.guestId || "").toString().trim().slice(0, 64) || null;

  // Pro+ setting: the owner may require a signed-in account instead of guest
  // posting. `req.publicTenant.require_auth_to_post` is the STORED preference
  // (attachPublicTenant already fetched it, so this costs no extra query); the
  // plan is re-checked live here rather than trusted from that stored value,
  // so a lapsed subscription can't keep locking real visitors out.
  if (!authorId && req?.publicTenant?.require_auth_to_post) {
    const limits = getPlanLimits(await getTenantPlan(tenantId));
    if (limits.restrictAnonymousPosting) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.UNAUTHORIZED, "signin_required_to_post", lg)
      );
    }
  }

  if (!title) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "title_required", lg)
    );
  }
  if (title.length > 200) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "title_too_long", lg)
    );
  }
  // Guests must leave an email so the team can reach them about their post.
  // Logged-in submissions (authorId set) already carry a verified account email.
  if (!authorId && !submitterEmail) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "email_required", lg)
    );
  }
  if (submitterEmail && !EMAIL_RE.test(submitterEmail)) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email", lg)
    );
  }

  // ---- Spam evaluation (guests only; see publicWriteGuard) -----------------
  //
  // Count recent near-identical submissions on this board. Normalized compare so
  // trivial edits (case, punctuation, spacing) don't evade it. Bounded to 24h and
  // to the same tenant, and best-effort — a failure here must not block a post.
  let duplicateCount = 0;
  if (!authorId) {
    try {
      const normalized = normalizeForCompare(`${title} ${description}`);
      if (normalized) {
        const [dupes] = await pool.query(
          `SELECT COUNT(*) AS n FROM posts
            WHERE tenant_id = ?
              AND author_id IS NULL
              AND created_at > (NOW() - INTERVAL 24 HOUR)
              AND LOWER(CONCAT(title, ' ', description)) LIKE ?`,
          [tenantId, `%${normalized.slice(0, 80)}%`]
        );
        duplicateCount = Number(dupes?.[0]?.n) || 0;
      }
    } catch {
      /* best effort — an unavailable dupe check just scores 0 */
    }
  }

  const guard = await evaluatePublicWrite({
    tenantId,
    req,
    data,
    title,
    body: description,
    email: submitterEmail,
    duplicateCount,
    isAuthenticated: Boolean(authorId),
  });

  // Honeypot tripped. Report success and store nothing — an error would tell the
  // bot its submission was detected and let it iterate until it isn't.
  if (guard.discard) {
    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.CREATED,
        "post_created_successfully",
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

  const _query = `
    INSERT INTO posts
      (tenant_id, author_id, submitter_name, submitter_email, guest_id, voter_hash,
       title, description, post_type, status, priority,
       moderation_state, spam_score, spam_reasons)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 3, ?, ?, ?)
  `;

  try {
    const [result] = await pool.query(_query, [
      tenantId,
      authorId,
      submitterName,
      submitterEmail,
      guestId,
      guard.voterHash,
      title,
      description,
      postType,
      guard.moderationState,
      guard.score,
      guard.reasons.length ? JSON.stringify(guard.reasons) : null,
    ]);

    // Quarantined content notifies nobody. Emailing an owner about every spam
    // post would turn a spam flood into an inbox flood — which is worse, because
    // it reaches them somewhere they can't moderate it.
    const quarantined = guard.moderationState === "spam";

    // Link any attachments uploaded for this submission (Pro+; the upload
    // endpoint already plan-gated). Best-effort, scoped to this tenant.
    await attachToPost(pool, data?.attachmentIds, result.insertId, tenantId);

    if (!quarantined) {
      // Tell the workspace owner. Deliberately NOT awaited: a slow SMTP round-trip
      // must not delay the visitor's submission, and a mail failure must not fail
      // the post (the notifier swallows its own errors).
      notifyOwnerOfNewPost(
        tenantId,
        result.insertId,
        { title, description, postType, submitterName },
        authUser
      ).catch(() => {});

      // In-app notification to the whole team (except the poster, if they're a
      // member). Fire-and-forget, same as the email above.
      const who = authUser?.fullName || submitterName || "Someone";
      notifyTeam(tenantId, {
        type: "new_feedback",
        title: `New feedback: ${truncate(title, 80)}`,
        message: `${who} submitted ${TYPE_LABEL[postType] || "feedback"}.`,
        referenceType: "post",
        referenceId: result.insertId,
        excludeUserId: authorId,
      }).catch(() => {});
    }

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.CREATED,
        "post_created_successfully",
        lg,
        { id: result.insertId }
      )
    );
  } catch (error) {
    console.error("Error creating public post:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_create_post",
        lg
      )
    );
  }
};

module.exports = { createPublicPost };
