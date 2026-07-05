const express = require("express");
const adminRouter = express.Router();

const { languageValidator } = require("../../middlewares/common/languageValidator");
const { authenticateAdmin } = require("../../middlewares/jwt/authenticateAdmin");
const { adminLogin } = require("../../main/admin/adminLogin");
const { getOverview } = require("../../main/admin/getOverview");
const {
  listWorkspaces,
  getWorkspace,
  updateWorkspace,
  setWorkspacePlan,
  deleteWorkspace,
} = require("../../main/admin/workspaces");
const {
  listAllUsers,
  updateUser,
  resetUserPassword,
  deleteUser,
} = require("../../main/admin/adminUsers");
const {
  listAdmins,
  createAdmin,
  setAdminActive,
  deleteAdmin,
} = require("../../main/admin/manageAdmins");
const {
  listPromoCodes,
  createPromoCode,
  revokePromoCode,
} = require("../../main/admin/promo");
const {
  listOffers,
  createOffer,
  deactivateOffer,
} = require("../../main/admin/offers");
const {
  listWorkspacePosts,
  setPostStatus,
  setPostPin,
  deleteWorkspacePost,
} = require("../../main/admin/adminPosts");
const {
  listPostComments,
  deleteComment,
} = require("../../main/admin/adminComments");

/** Standard { status, message, [key] } response shape. */
function send(res, data, key = "data") {
  const { statusCode, status, message, result } = data;
  const body = { status, message };
  if (result !== undefined) body[key] = result;
  return res.status(statusCode).send(body);
}

const lgOf = (req) => req.body?.lg || req.query?.lg || "en";

// --- Public: admin login ---
adminRouter.post("/auth/login", languageValidator, async (req, res) => {
  const { userData = {}, lg } = req.body;
  adminLogin(userData, lg)
    .then((data) => send(res, data, "admin"))
    .catch((error) => send(res, error));
});

// --- Everything below requires an admin token ---
adminRouter.use(authenticateAdmin);

// Overview
adminRouter.get("/overview", (req, res) =>
  getOverview(lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);

// Workspaces
adminRouter.get("/workspaces", (req, res) =>
  listWorkspaces(req.query?.search, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.get("/workspaces/:id", (req, res) =>
  getWorkspace(req.params.id, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.put("/workspaces/:id", (req, res) =>
  updateWorkspace(req.params.id, req.body, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.put("/workspaces/:id/plan", (req, res) =>
  setWorkspacePlan(req.params.id, req.body?.plan, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.delete("/workspaces/:id", (req, res) =>
  deleteWorkspace(req.params.id, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);

// Moderate a workspace's posts (admin acts across any tenant).
adminRouter.get("/workspaces/:id/posts", (req, res) =>
  listWorkspacePosts(req.params.id, req.query, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.put("/workspaces/:id/posts/:postId/status", (req, res) =>
  setPostStatus(req.params.id, req.params.postId, req.body?.status, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.put("/workspaces/:id/posts/:postId/pin", (req, res) =>
  setPostPin(req.params.id, req.params.postId, req.body?.isPinned, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.delete("/workspaces/:id/posts/:postId", (req, res) =>
  deleteWorkspacePost(req.params.id, req.params.postId, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);

// Moderate a post's comments
adminRouter.get("/workspaces/:id/posts/:postId/comments", (req, res) =>
  listPostComments(req.params.id, req.params.postId, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.delete("/workspaces/:id/comments/:commentId", (req, res) =>
  deleteComment(req.params.id, req.params.commentId, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);

// Users
adminRouter.get("/users", (req, res) =>
  listAllUsers(req.query?.search, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.put("/users/:id", (req, res) =>
  updateUser(req.params.id, req.body, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.put("/users/:id/password", (req, res) =>
  resetUserPassword(req.params.id, req.body?.password, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.delete("/users/:id", (req, res) =>
  deleteUser(req.params.id, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);

// Admins
adminRouter.get("/admins", (req, res) =>
  listAdmins(lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.post("/admins", (req, res) =>
  createAdmin(req.body, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.put("/admins/:id/active", (req, res) =>
  setAdminActive(req.params.id, req.body?.isActive, req.admin.id, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.delete("/admins/:id", (req, res) =>
  deleteAdmin(req.params.id, req.admin.id, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);

// Promo codes
adminRouter.get("/promo-codes", (req, res) =>
  listPromoCodes(lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.post("/promo-codes", (req, res) =>
  createPromoCode(req.body, req.admin.id, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.put("/promo-codes/:id/revoke", (req, res) =>
  revokePromoCode(req.params.id, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);

// Offers
adminRouter.get("/offers", (req, res) =>
  listOffers(lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.post("/offers", (req, res) =>
  createOffer(req.body, req.admin.id, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);
adminRouter.put("/offers/:id/deactivate", (req, res) =>
  deactivateOffer(req.params.id, lgOf(req)).then((d) => send(res, d)).catch((e) => send(res, e))
);

module.exports = { adminRouter };
