const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

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
const createPublicPost = async (tenantId, data, lg) => {
  const title = (data?.title || "").trim();
  const description = (data?.description || "").trim();
  const postType = POST_TYPES.includes(data?.postType)
    ? data.postType
    : "feedback";
  const submitterName = (data?.submitterName || "").trim().slice(0, 120) || null;
  const submitterEmail =
    (data?.submitterEmail || "").trim().slice(0, 255) || null;

  if (!title || !description) {
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.BAD_REQUEST,
        "title_and_description_required",
        lg
      )
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
      (tenant_id, author_id, submitter_name, submitter_email, title, description, post_type, status, priority)
    VALUES (?, NULL, ?, ?, ?, ?, ?, 'open', 3)
  `;

  try {
    const [result] = await pool.query(_query, [
      tenantId,
      submitterName,
      submitterEmail,
      title,
      description,
      postType,
    ]);

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
