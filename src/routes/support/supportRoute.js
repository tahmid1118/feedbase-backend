const express = require("express");
const supportRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const {
  openSession,
  getMessages,
  sendMessage,
  getUnread,
} = require("../../main/support/userSupport");

/**
 * User-facing support chat. Every authenticated tenant user (any role, any plan)
 * may contact the platform admin. Sessions are the user's own and open-only —
 * a closed session is unreachable here (the admin keeps the history).
 */

const lgOf = (req) => req.body?.lg || req.query?.lg || "en";

const send = (res) => (data) => {
  const { statusCode, status, message, result } = data;
  return res.status(statusCode).send(
    result !== undefined && result !== null
      ? { status, message, data: result }
      : { status, message }
  );
};

// Resume the caller's open session or start one.
supportRouter.post("/session", authenticateToken, languageValidator, (req, res) => {
  openSession({ ...req.auth, lg: lgOf(req) })
    .then(send(res))
    .catch(send(res));
});

// Read the messages of an open session the caller owns.
supportRouter.post("/messages/:sessionId/list", authenticateToken, languageValidator, (req, res) => {
  getMessages(req.params.sessionId, { ...req.auth, lg: lgOf(req) })
    .then(send(res))
    .catch(send(res));
});

// Post a message into an open session the caller owns.
supportRouter.post("/messages/:sessionId", authenticateToken, languageValidator, (req, res) => {
  sendMessage(req.params.sessionId, req.body?.body, { ...req.auth, lg: lgOf(req) })
    .then(send(res))
    .catch(send(res));
});

// Unread admin replies for the floating badge.
supportRouter.post("/unread", authenticateToken, languageValidator, (req, res) => {
  getUnread({ ...req.auth, lg: lgOf(req) })
    .then(send(res))
    .catch(send(res));
});

module.exports = { supportRouter };
