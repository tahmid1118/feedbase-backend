const express = require("express");
const voteRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { getPostVotes } = require("../../main/vote/getPostVotes");

/**
 * Upvoting is a PUBLIC-BOARD-only action — a workspace's own owner/team must not
 * vote on their users' feedback, so there is deliberately no authenticated
 * add/remove vote endpoint here. Visitors vote via
 * `POST /public/:tenant/posts/:id/vote` (`togglePublicVote`), identified by their
 * guest id / account. This route file is read-only by design.
 */

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
