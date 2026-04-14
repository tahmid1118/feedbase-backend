const express = require("express");
const voteRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { addVote } = require("../../main/vote/addVote");
const { removeVote } = require("../../main/vote/removeVote");
const { getPostVotes } = require("../../main/vote/getPostVotes");

/**
 * @description Add upvote to a post
 */
voteRouter.post("/add", authenticateToken, languageValidator, async (req, res) => {
  const { postId, lg } = req.body;
  const authData = { ...req.auth, lg };
  addVote(postId, authData)
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
 * @description Remove upvote from a post
 */
voteRouter.delete("/remove/:postId", authenticateToken, languageValidator, async (req, res) => {
  const { postId } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  removeVote(postId, authData)
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
 * @description Get votes for a post
 */
voteRouter.post("/post/:postId", authenticateToken, languageValidator, async (req, res) => {
  const { postId } = req.params;
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getPostVotes(postId, authData)
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
  voteRouter,
};
