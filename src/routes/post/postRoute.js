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

module.exports = {
  postRouter,
};
