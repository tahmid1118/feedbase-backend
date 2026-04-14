const express = require("express");
const notificationRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { paginationData } = require("../../middlewares/pagination/paginationData");
const { getNotifications } = require("../../main/notification/getNotifications");
const { markAsRead } = require("../../main/notification/markAsRead");
const { markAllAsRead } = require("../../main/notification/markAllAsRead");
const { deleteNotification } = require("../../main/notification/deleteNotification");
const { getUnreadCount } = require("../../main/notification/getUnreadCount");

/**
 * @description Get user notifications with pagination
 */
notificationRouter.post("/list", authenticateToken, paginationData, languageValidator, async (req, res) => {
  const { paginationData, lg } = req.body;
  const authData = { ...req.auth, lg };
  getNotifications(paginationData, authData)
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
 * @description Mark notification as read
 */
notificationRouter.patch("/mark-read/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  markAsRead(id, authData)
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
 * @description Mark all notifications as read
 */
notificationRouter.patch("/mark-all-read", authenticateToken, languageValidator, async (req, res) => {
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  markAllAsRead(authData)
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
 * @description Delete notification
 */
notificationRouter.delete("/delete/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  deleteNotification(id, authData)
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
 * @description Get unread notification count
 */
notificationRouter.post("/unread-count", authenticateToken, languageValidator, async (req, res) => {
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getUnreadCount(authData)
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
  notificationRouter,
};
