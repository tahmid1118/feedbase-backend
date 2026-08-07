const express = require("express");
const commentRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { createComment } = require("../../main/comment/createComment");
const { updateComment } = require("../../main/comment/updateComment");
const { deleteComment } = require("../../main/comment/deleteComment");
const { getPostComments } = require("../../main/comment/getPostComments");
const { updateCommentModeration } = require("../../main/comment/updateCommentModeration");

/**
 * @description Create a new comment
 */
commentRouter.post("/create", authenticateToken, languageValidator, async (req, res) => {
  const { commentData, lg } = req.body;
  const authData = { ...req.auth, lg };
  createComment(commentData, authData)
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
 * @description Update comment
 */
commentRouter.put("/update/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { body, lg } = req.body;
  const authData = { ...req.auth, lg };
  updateComment(id, body, authData)
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
 * @description Reclassify a comment on the spam axis (owner-only, not
 * plan-gated). Without this a quarantined comment was hidden from the public
 * board with no way back — see updateCommentModeration.js.
 * PATCH /comments/moderation/:id  { moderationState }
 */
commentRouter.patch("/moderation/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { moderationState, lg } = req.body;
  const authData = { ...req.auth, lg };
  updateCommentModeration(id, moderationState, authData)
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
 * @description Delete comment
 */
commentRouter.delete("/delete/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  deleteComment(id, authData)
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
 * @description Get comments for a post
 */
commentRouter.post("/post/:postId", authenticateToken, languageValidator, async (req, res) => {
  const { postId } = req.params;
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getPostComments(postId, authData)
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
  commentRouter,
};
