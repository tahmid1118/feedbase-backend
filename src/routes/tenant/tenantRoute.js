const express = require("express");
const tenantRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { createTenant } = require("../../main/tenant/createTenant");
const { getTenantById } = require("../../main/tenant/getTenantById");
const { updateTenant } = require("../../main/tenant/updateTenant");
const { getTenantList } = require("../../main/tenant/getTenantList");

/**
 * @description Create a new tenant
 */
tenantRouter.post("/create", languageValidator, async (req, res) => {
  const { tenantData, lg } = req.body;
  createTenant(tenantData, lg)
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
 * @description Get tenant by ID
 */
tenantRouter.post("/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || 'en';
  getTenantById(id, lg)
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
 * @description Update tenant
 */
tenantRouter.put("/update/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { tenantData, lg } = req.body;
  updateTenant(id, tenantData, lg)
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
 * @description Get all tenants list
 */
tenantRouter.post("/", authenticateToken, languageValidator, async (req, res) => {
  const lg = req.body.lg || 'en';
  getTenantList(lg)
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
  tenantRouter,
};
