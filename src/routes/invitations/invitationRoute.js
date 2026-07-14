const express = require("express");
const invitationRouter = express.Router();

const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const {
  createInvitation,
  listInvitations,
  revokeInvitation,
  acceptInvitationAsExistingUser,
} = require("../../main/invitations/invitations");

function send(res, data) {
  const { statusCode, status, message, result } = data;
  const body = { status, message };
  if (result !== undefined) body.data = result;
  return res.status(statusCode).send(body);
}

invitationRouter.use(authenticateToken);

/** @description Invite someone to the workspace by email (owner only). */
invitationRouter.post("/", languageValidator, (req, res) =>
  createInvitation(req.body, { ...req.auth, lg: req.body.lg })
    .then((d) => send(res, d))
    .catch((e) => send(res, e))
);

/** @description Outstanding invitations for the workspace. */
invitationRouter.post("/list", languageValidator, (req, res) =>
  listInvitations({ ...req.auth, lg: req.body.lg })
    .then((d) => send(res, d))
    .catch((e) => send(res, e))
);

/** @description Revoke a pending invitation (owner only). */
invitationRouter.delete("/:id", (req, res) =>
  revokeInvitation(req.params.id, { ...req.auth, lg: req.body?.lg || "en" })
    .then((d) => send(res, d))
    .catch((e) => send(res, e))
);

/**
 * @description Accept an invitation as an EXISTING, signed-in account. The
 * session email must match the invited email.
 */
invitationRouter.post("/:token/accept", languageValidator, (req, res) =>
  acceptInvitationAsExistingUser(req.params.token, { ...req.auth, lg: req.body.lg })
    .then((d) => send(res, d))
    .catch((e) => send(res, e))
);

module.exports = { invitationRouter };
