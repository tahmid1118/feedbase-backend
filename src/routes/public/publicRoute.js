const express = require("express");
const publicRouter = express.Router();

const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

const { resolvePublicTenant } = require("../../main/public/resolvePublicTenant");
const { getPublicBoard } = require("../../main/public/getPublicBoard");
const { createPublicPost } = require("../../main/public/createPublicPost");
const { togglePublicVote } = require("../../main/public/togglePublicVote");
const { createPublicComment } = require("../../main/public/createPublicComment");
const { getPublicPostDetail } = require("../../main/public/getPublicPostDetail");
const { getPublicRoadmap } = require("../../main/public/getPublicRoadmap");
const {
  getPublicChangelogList,
  getPublicChangelogDetail,
} = require("../../main/public/getPublicChangelog");

/** Send a resolved/rejected handler response in the project's standard shape. */
function send(res, data) {
  const { statusCode, status, message, result } = data;
  const body = { status, message };
  if (result !== undefined) body.data = result;
  return res.status(statusCode).send(body);
}

/**
 * Resolve the active tenant from the `:subdomain` path param (matched against
 * either subdomain or custom domain) and attach it as `req.publicTenant`.
 */
async function attachPublicTenant(req, res, next) {
  const lg = req.query.lg || req.body?.lg || "en";
  const identifier = (req.params.subdomain || "").trim().toLowerCase();

  try {
    const [rows] = await pool.query(
      `SELECT id, name, slug, subdomain, custom_domain,
              branding_logo_url, branding_primary_color
       FROM tenants
       WHERE is_active = 1 AND (subdomain = ? OR custom_domain = ?)
       LIMIT 1`,
      [identifier, identifier]
    );

    if (rows.length === 0) {
      return send(
        res,
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "tenant_not_found", lg)
      );
    }

    req.publicTenant = rows[0];
    req.lg = lg;
    next();
  } catch (error) {
    console.error("attachPublicTenant error:", error);
    return send(
      res,
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_get_tenant",
        lg
      )
    );
  }
}

/**
 * @description Resolve a tenant by subdomain or custom domain.
 * GET /public/tenant?subdomain=acme  (or ?domain=feedback.acme.test)
 */
publicRouter.get("/tenant", async (req, res) => {
  const lg = req.query.lg || "en";
  const identifier = req.query.subdomain || req.query.domain || "";
  resolvePublicTenant(identifier, lg)
    .then((data) => send(res, data))
    .catch((error) => send(res, error));
});

/**
 * @description Public feedback board for a tenant.
 * POST /public/:subdomain/posts  { paginationData, filters }
 */
publicRouter.post("/:subdomain/posts", attachPublicTenant, async (req, res) => {
  const { paginationData, filters } = req.body || {};
  getPublicBoard(req.publicTenant.id, paginationData, filters, req.lg)
    .then((data) => send(res, data))
    .catch((error) => send(res, error));
});

/**
 * @description Submit feedback from the public portal (no auth). The author is a
 * guest; name/email are optional.
 * POST /public/:subdomain/feedback  { title, description, postType, submitterName?, submitterEmail? }
 */
publicRouter.post(
  "/:subdomain/feedback",
  attachPublicTenant,
  async (req, res) => {
    createPublicPost(req.publicTenant.id, req.body, req.lg)
      .then((data) => send(res, data))
      .catch((error) => send(res, error));
  }
);

/**
 * @description Public post detail with its comment thread.
 * POST /public/:subdomain/posts/:postId
 */
publicRouter.post(
  "/:subdomain/posts/:postId",
  attachPublicTenant,
  async (req, res) => {
    getPublicPostDetail(req.publicTenant.id, req.params.postId, req.lg)
      .then((data) => send(res, data))
      .catch((error) => send(res, error));
  }
);

/**
 * @description Toggle an anonymous upvote (spam-limited per browser via guestId).
 * POST /public/:subdomain/posts/:postId/vote  { guestId }
 */
publicRouter.post(
  "/:subdomain/posts/:postId/vote",
  attachPublicTenant,
  async (req, res) => {
    togglePublicVote(
      req.publicTenant.id,
      req.params.postId,
      req.body?.guestId,
      req.lg
    )
      .then((data) => send(res, data))
      .catch((error) => send(res, error));
  }
);

/**
 * @description Add an anonymous comment/reply to a post.
 * POST /public/:subdomain/posts/:postId/comments  { body, parentCommentId?, submitterName?, submitterEmail? }
 */
publicRouter.post(
  "/:subdomain/posts/:postId/comments",
  attachPublicTenant,
  async (req, res) => {
    createPublicComment(
      req.publicTenant.id,
      req.params.postId,
      req.body,
      req.lg
    )
      .then((data) => send(res, data))
      .catch((error) => send(res, error));
  }
);

/**
 * @description Public roadmap (columns + items).
 * POST /public/:subdomain/roadmap
 */
publicRouter.post(
  "/:subdomain/roadmap",
  attachPublicTenant,
  async (req, res) => {
    getPublicRoadmap(req.publicTenant.id, req.lg)
      .then((data) => send(res, data))
      .catch((error) => send(res, error));
  }
);

/**
 * @description Public, published-only changelog list.
 * POST /public/:subdomain/changelog  { paginationData }
 */
publicRouter.post(
  "/:subdomain/changelog",
  attachPublicTenant,
  async (req, res) => {
    getPublicChangelogList(req.publicTenant.id, req.body?.paginationData, req.lg)
      .then((data) => send(res, data))
      .catch((error) => send(res, error));
  }
);

/**
 * @description Public, published-only changelog detail.
 * POST /public/:subdomain/changelog/:changelogId
 */
publicRouter.post(
  "/:subdomain/changelog/:changelogId",
  attachPublicTenant,
  async (req, res) => {
    getPublicChangelogDetail(
      req.publicTenant.id,
      req.params.changelogId,
      req.lg
    )
      .then((data) => send(res, data))
      .catch((error) => send(res, error));
  }
);

module.exports = { publicRouter };
