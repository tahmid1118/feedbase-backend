const express = require("express");
const tagRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { createTag } = require("../../main/tag/createTag");
const { updateTag } = require("../../main/tag/updateTag");
const { deleteTag } = require("../../main/tag/deleteTag");
const { getTagList } = require("../../main/tag/getTagList");
const { addTagToPost } = require("../../main/tag/addTagToPost");
const { removeTagFromPost } = require("../../main/tag/removeTagFromPost");

/**
 * @description Create a new tag
 */
tagRouter.post("/create", authenticateToken, languageValidator, async (req, res) => {
  const { tagData, lg } = req.body;
  const authData = { ...req.auth, lg };
  createTag(tagData, authData)
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
 * @description Update tag
 */
tagRouter.put("/update/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { tagData, lg } = req.body;
  const authData = { ...req.auth, lg };
  updateTag(id, tagData, authData)
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
 * @description Delete tag
 */
tagRouter.delete("/delete/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  deleteTag(id, authData)
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
 * @description Get all tags for tenant
 */
tagRouter.post("/list", authenticateToken, languageValidator, async (req, res) => {
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getTagList(authData)
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
 * @description Add tag to post
 */
tagRouter.post("/add-to-post", authenticateToken, languageValidator, async (req, res) => {
  const { postId, tagId, lg } = req.body;
  const authData = { ...req.auth, lg };
  addTagToPost(postId, tagId, authData)
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
 * @description Remove tag from post
 */
tagRouter.delete("/remove-from-post", authenticateToken, languageValidator, async (req, res) => {
  const { postId, tagId, lg } = req.body;
  const authData = { ...req.auth, lg };
  removeTagFromPost(postId, tagId, authData)
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
  tagRouter,
};
