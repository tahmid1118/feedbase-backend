const express = require("express");
const integrationRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { createIntegration } = require("../../main/integration/createIntegration");
const { updateIntegration } = require("../../main/integration/updateIntegration");
const { deleteIntegration } = require("../../main/integration/deleteIntegration");
const { getIntegrationList } = require("../../main/integration/getIntegrationList");
const { toggleIntegration } = require("../../main/integration/toggleIntegration");

/**
 * @description Create a new integration
 */
integrationRouter.post("/create", authenticateToken, languageValidator, async (req, res) => {
  const { integrationData, lg } = req.body;
  const authData = { ...req.auth, lg };
  createIntegration(integrationData, authData)
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
 * @description Update integration
 */
integrationRouter.put("/update/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { integrationData, lg } = req.body;
  const authData = { ...req.auth, lg };
  updateIntegration(id, integrationData, authData)
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
 * @description Delete integration
 */
integrationRouter.delete("/delete/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  deleteIntegration(id, authData)
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
 * @description Get integrations list
 */
integrationRouter.post("/list", authenticateToken, languageValidator, async (req, res) => {
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getIntegrationList(authData)
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
 * @description Toggle integration active status
 */
integrationRouter.patch("/toggle/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  toggleIntegration(id, authData)
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
  integrationRouter,
};
