const express = require("express");
const apiKeyRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { createApiKey } = require("../../main/apikey/createApiKey");
const { revokeApiKey } = require("../../main/apikey/revokeApiKey");
const { getApiKeyList } = require("../../main/apikey/getApiKeyList");
const { updateApiKey } = require("../../main/apikey/updateApiKey");

/**
 * @description Create a new API key
 */
apiKeyRouter.post("/create", authenticateToken, languageValidator, async (req, res) => {
  const { apiKeyData, lg } = req.body;
  const authData = { ...req.auth, lg };
  createApiKey(apiKeyData, authData)
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
 * @description Update API key
 */
apiKeyRouter.put("/update/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { apiKeyData, lg } = req.body;
  const authData = { ...req.auth, lg };
  updateApiKey(id, apiKeyData, authData)
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
 * @description Revoke API key
 */
apiKeyRouter.patch("/revoke/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  revokeApiKey(id, authData)
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
 * @description Get API keys list
 */
apiKeyRouter.post("/list", authenticateToken, languageValidator, async (req, res) => {
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getApiKeyList(authData)
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
  apiKeyRouter,
};
