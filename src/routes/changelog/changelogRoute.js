const express = require("express");
const changelogRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { paginationData } = require("../../middlewares/pagination/paginationData");
const { createChangelog } = require("../../main/changelog/createChangelog");
const { updateChangelog } = require("../../main/changelog/updateChangelog");
const { deleteChangelog } = require("../../main/changelog/deleteChangelog");
const { getChangelogById } = require("../../main/changelog/getChangelogById");
const { getChangelogList } = require("../../main/changelog/getChangelogList");
const { publishChangelog } = require("../../main/changelog/publishChangelog");

/**
 * @description Create a new changelog entry
 */
changelogRouter.post("/create", authenticateToken, languageValidator, async (req, res) => {
  const { changelogData, lg } = req.body;
  const authData = { ...req.auth, lg };
  createChangelog(changelogData, authData)
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
 * @description Update changelog entry
 */
changelogRouter.put("/update/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { changelogData, lg } = req.body;
  const authData = { ...req.auth, lg };
  updateChangelog(id, changelogData, authData)
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
 * @description Delete changelog entry
 */
changelogRouter.delete("/delete/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  deleteChangelog(id, authData)
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
 * @description Get changelog list with pagination
 */
changelogRouter.post("/list", authenticateToken, paginationData, languageValidator, async (req, res) => {
  const { paginationData, lg } = req.body;
  const authData = { ...req.auth, lg };
  getChangelogList(paginationData, authData)
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
 * @description Get changelog by ID
 */
changelogRouter.post("/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getChangelogById(id, authData)
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
 * @description Publish changelog entry
 */
changelogRouter.patch("/publish/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  publishChangelog(id, authData)
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
  changelogRouter,
};
