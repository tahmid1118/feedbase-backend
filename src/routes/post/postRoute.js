const express = require("express");
const postRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { paginationData } = require("../../middlewares/pagination/paginationData");
const { createPost } = require("../../main/post/createPost");
const { getPostById } = require("../../main/post/getPostById");
const { updatePost } = require("../../main/post/updatePost");
const { deletePost } = require("../../main/post/deletePost");
const { getPostList } = require("../../main/post/getPostList");
const { updatePostStatus } = require("../../main/post/updatePostStatus");
const { updatePostModeration } = require("../../main/post/updatePostModeration");
const { purgeSpamPosts } = require("../../main/post/purgeSpam");
const { notifyFeedbackImplemented } = require("../../main/post/notifyFeedbackImplemented");
const { updatePostPin } = require("../../main/post/updatePostPin");
const { setPostDuplicate } = require("../../main/post/setPostDuplicate");
const { getDuplicateSuggestions } = require("../../main/post/getDuplicateSuggestions");
const { storeAttachment } = require("../../main/attachments/attachments");
const { attachmentValidator } = require("../../common/file-upload/attachment-validator");
const { errorCheck } = require("../../common/file-upload/check-error");
const { requireAttachmentsAuthed } = require("../../middlewares/plan/requireAttachments");

/**
 * @description Create a new post (feedback/feature request/bug report)
 */
postRouter.post("/create", authenticateToken, languageValidator, async (req, res) => {
  const { postData, lg } = req.body;
  const authData = { ...req.auth, lg };
  createPost(postData, authData)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        data: result,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Upload one photo/video attachment for a feedback post (Pro+).
 * Returns the stored attachment incl. its id; the client sends the ids back on
 * `/posts/create` to link them. The plan gate runs BEFORE multer so a Free
 * workspace never streams the file. Registered before `/:id` so "attachment"
 * isn't read as a post id.
 */
postRouter.post(
  "/attachment",
  authenticateToken,
  requireAttachmentsAuthed,
  attachmentValidator.single("file"),
  errorCheck,
  async (req, res) => {
    const lg = req.body?.lg || "en";
    storeAttachment(req.file, req.auth.tenantId, lg)
      .then((data) => {
        const { statusCode, status, message, result } = data;
        return res.status(statusCode).send({ status, message, data: result });
      })
      .catch((error) => {
        const { statusCode, status, message } = error;
        return res.status(statusCode).send({ status, message });
      });
  }
);

/**
 * @description Update post
 */
postRouter.put("/update/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { postData, lg } = req.body;
  const authData = { ...req.auth, lg };
  updatePost(id, postData, authData)
    .then((data) => {
      const { statusCode, status, message } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Delete post
 */
postRouter.delete("/delete/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  deletePost(id, authData)
    .then((data) => {
      const { statusCode, status, message } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Get posts list with pagination and filters
 */
postRouter.post("/list", authenticateToken, paginationData, languageValidator, async (req, res) => {
  const { paginationData, filters, lg } = req.body;
  const authData = { ...req.auth, lg };
  getPostList(paginationData, filters, authData)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        data: result,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Get post by ID
 */
postRouter.post("/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getPostById(id, authData)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        data: result,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Update post status
 */
postRouter.patch("/status/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { newStatus, lg } = req.body;
  const authData = { ...req.auth, lg };
  updatePostStatus(id, newStatus, authData)
    .then((data) => {
      const { statusCode, status, message } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Reclassify a post on the SPAM axis (the human override for the
 * automatic scorer). `moderationState` is 'published' | 'pending' | 'spam';
 * 'published' also clears the score so the item leaves the review queue.
 * PATCH /posts/moderation/:id  { moderationState }
 */
postRouter.patch("/moderation/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { moderationState, lg } = req.body;
  const authData = { ...req.auth, lg };
  updatePostModeration(id, moderationState, authData)
    .then((data) => {
      const { statusCode, status, message } = data;
      return res.status(statusCode).send({ status, message });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Permanently delete spam-QUARANTINED posts. Owner-only, and
 * deliberately NOT plan-gated — clearing our own filter's output must not
 * require an upgrade (unlike DELETE /posts/:id, which is Pro+).
 *
 * Body is either `{ ids: [1,2,3] }` or `{ olderThanDays: 30 }`. Only rows with
 * `moderation_state = 'spam'` are ever touched: flagged-but-published feedback
 * shares the review queue but is excluded in SQL, not just in the UI.
 * POST /posts/spam/purge
 */
postRouter.post("/spam/purge", authenticateToken, languageValidator, async (req, res) => {
  const { ids, olderThanDays, lg } = req.body || {};
  const authData = { ...req.auth, lg };
  purgeSpamPosts(authData, ids, olderThanDays)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Email the submitter that their feedback is implemented (Pro+,
 * owner-only, post must be completed).
 */
postRouter.post("/:id/notify-implemented", authenticateToken, languageValidator, async (req, res) => {
  const authData = { ...req.auth, lg: req.body.lg };
  notifyFeedbackImplemented(req.params.id, authData)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Pin or unpin a post (toggles when isPinned omitted)
 */
postRouter.patch("/pin/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { isPinned, lg } = req.body;
  const authData = { ...req.auth, lg };
  updatePostPin(id, isPinned, authData)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        data: result,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Mark a post as duplicate of another (or clear with duplicateOfPostId: null)
 */
postRouter.patch("/duplicate/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { duplicateOfPostId, lg } = req.body;
  const authData = { ...req.auth, lg };
  setPostDuplicate(id, duplicateOfPostId, authData)
    .then((data) => {
      const { statusCode, status, message } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Get suggested duplicate posts for a given post
 */
postRouter.post("/:id/duplicate-suggestions", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getDuplicateSuggestions(id, authData)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        data: result,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

module.exports = {
  postRouter,
};
