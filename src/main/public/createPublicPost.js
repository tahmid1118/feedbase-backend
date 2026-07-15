const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { notifyOwnerOfNewPost } = require("./notifyOwnerOfNewPost");
const { attachToPost } = require("../attachments/attachments");

const POST_TYPES = ["feedback", "feature_request", "bug_report"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @description Create a feedback post from the PUBLIC portal (no auth). The
 * author is a guest: `author_id` is NULL and the optional name/email are stored
 * on the post. New public submissions always start as `open`.
 * @param {number} tenantId resolved from the portal subdomain
 * @param {object} data { title, description, postType, submitterName, submitterEmail }
 * @param {string} lg
 */
const createPublicPost = async (tenantId, data, authUser, lg) => {
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
  if (submitterEmail && !EMAIL_RE.test(submitterEmail)) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_email", lg)
    );
  }

  const _query = `
    INSERT INTO posts
      (tenant_id, author_id, submitter_name, submitter_email, guest_id, title, description, post_type, status, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 3)
  `;

  try {
    const [result] = await pool.query(_query, [
      tenantId,
      authorId,
      submitterName,
      submitterEmail,
      guestId,
      title,
      description,
      postType,
    ]);

    // Link any attachments uploaded for this submission (Pro+; the upload
    // endpoint already plan-gated). Best-effort, scoped to this tenant.
    await attachToPost(pool, data?.attachmentIds, result.insertId, tenantId);

    // Tell the workspace owner. Deliberately NOT awaited: a slow SMTP round-trip
    // must not delay the visitor's submission, and a mail failure must not fail
    // the post (the notifier swallows its own errors).
    notifyOwnerOfNewPost(
      tenantId,
      result.insertId,
      { title, description, postType, submitterName },
      authUser
    ).catch(() => {});

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
