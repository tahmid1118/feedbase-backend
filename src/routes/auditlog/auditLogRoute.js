const express = require("express");
const auditLogRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { paginationData } = require("../../middlewares/pagination/paginationData");
const { getAuditLogs } = require("../../main/auditlog/getAuditLogs");
const { createAuditLog } = require("../../main/auditlog/createAuditLog");

/**
 * @description Get audit logs with pagination and filters
 */
auditLogRouter.post("/list", authenticateToken, paginationData, languageValidator, async (req, res) => {
  const { paginationData, filters, lg } = req.body;
  const authData = { ...req.auth, lg };
  getAuditLogs(paginationData, filters, authData)
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
 * @description Create audit log entry (internal use)
 */
auditLogRouter.post("/create", authenticateToken, languageValidator, async (req, res) => {
  const { logData, lg } = req.body;
  const authData = { ...req.auth, lg };
  createAuditLog(logData, authData)
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
  auditLogRouter,
};
