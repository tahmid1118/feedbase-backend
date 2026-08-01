const express = require("express");
const jwt = require("jsonwebtoken");
const userRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { revokeSession } = require("../../common/sessions");
const { setServerResponse } = require("../../common/setServerResponse");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { paginationData } = require("../../middlewares/pagination/paginationData");
const { userLogin } = require("../../main/users/userLogin");
const { oauthLogin } = require("../../main/users/oauthLogin");
const { registerNewUser } = require("../../main/users/registerNewUser");
const { getPersonalData } = require("../../main/users/gerUserPersonalData");
const { getUserTableData } = require("../../main/users/getUserTableData");
const { getUserListData } = require("../../main/users/getUserListData");
const { updatePersonalInfo } = require("../../main/users/updateUserData");
const { changeUserPassword } = require("../../main/users/changeUserPassword");
const { updateUserRole } = require("../../main/users/updateUserRole");
const {
  getAccountDeletionSummary,
  deleteAccount,
} = require("../../main/users/deleteAccount");
const {
  getWorkspaces,
  checkSubdomain,
  createWorkspace,
  switchWorkspace,
} = require("../../main/users/workspaces");
const {
  requestPasswordReset,
  validateResetToken,
  resetPassword,
} = require("../../main/users/passwordReset");

/**
 * @description User login
 */
userRouter.post("/login", languageValidator, async (req, res) => {
  const { userData = {}, lg } = req.body;
  userLogin(userData, lg, req)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        user: result,
      });
    })
    .catch((error) => {
      console.error("Login error:", error);
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Social sign-in / sign-up (google, facebook, github, microsoft).
 * The frontend completes the provider handshake and posts the verified identity
 * here. Requires `emailVerified: true` — see oauthLogin.js for why that is the
 * line between a convenience and an account-takeover route.
 */
userRouter.post("/oauth/login", languageValidator, async (req, res) => {
  const { userData = {}, lg } = req.body;
  oauthLogin(userData, lg, req)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        user: result,
      });
    })
    .catch((error) => {
      console.error("OAuth login error:", error);
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description End this device's session. On single-device plans this is what
 * frees the account to sign in elsewhere, so it must be called on sign-out.
 * Deliberately tolerant: an already-dead session still reports success.
 */
userRouter.post("/logout", languageValidator, async (req, res) => {
  const lg = req.body?.lg || "en";
  try {
    const parts = (req.header("Authorization") || "").split(" ");
    const token = parts[0] === "Bearer" ? parts[1] : null;
    let sid = null;
    if (token && token !== "undefined" && token !== "null") {
      try {
        sid = jwt.verify(token, process.env.SECRET_ACCESS_TOKEN)?.sid || null;
      } catch {
        // An expired/!invalid token has no session left to revoke — that's fine.
      }
    }
    if (sid) await revokeSession(sid);
    const data = setServerResponse(
      API_STATUS_CODE.OK,
      "logged_out_successfully",
      lg
    );
    return res.status(data.statusCode).send({
      status: data.status,
      message: data.message,
    });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(200).send({ status: true, message: "Logged out" });
  }
});

/**
 * @description Register new user
 */
userRouter.post("/register", languageValidator, async (req, res) => {
  const { userData = {}, lg } = req.body;
  registerNewUser(userData, lg)
    .then((data) => {
      const { statusCode, status, message } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    })
    .catch((error) => {
      console.error("Registration error:", error);
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Password reset — all UNAUTHENTICATED (the user has forgotten
 * their password and can't sign in). Rate limiting is applied per-path in app.js.
 */

// Request a reset link. Always returns success (no account enumeration).
userRouter.post("/password/forgot", languageValidator, async (req, res) => {
  const { email, lg } = req.body;
  requestPasswordReset(email, lg, req)
    .then(({ statusCode, status, message, result }) =>
      res.status(statusCode).send({ status, message, data: result })
    )
    .catch(({ statusCode, status, message }) =>
      res.status(statusCode).send({ status, message })
    );
});

// Validate a reset token so the reset page can render (or show an error state).
userRouter.get("/password/reset/:token", languageValidator, async (req, res) => {
  validateResetToken(req.params.token, req.query.lg || "en")
    .then(({ statusCode, status, message, result }) =>
      res.status(statusCode).send({ status, message, data: result })
    )
    .catch(({ statusCode, status, message }) =>
      res.status(statusCode).send({ status, message })
    );
});

// Consume a token and set the new password.
userRouter.post("/password/reset", languageValidator, async (req, res) => {
  const { token, password, lg } = req.body;
  resetPassword(token, password, lg)
    .then(({ statusCode, status, message }) =>
      res.status(statusCode).send({ status, message })
    )
    .catch(({ statusCode, status, message }) =>
      res.status(statusCode).send({ status, message })
    );
});

/**
 * @description This route is used to return user personal data.
 * It requires the user to be authenticated.
 */
userRouter.get("/personal-data", authenticateToken, async (req, res) => {
  const lg = req.query.lg || req.body.lg || 'en';
  getPersonalData({ ...req.auth, lg })
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
 * @description Update user data
 */
userRouter.post("/update", authenticateToken, languageValidator, async (req, res) => {
  const { userData, lg } = req.body;
  const authData = { ...req.auth, lg };
  updatePersonalInfo(userData, authData)
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
 * @description Update user role (admin only)
 */
userRouter.patch("/role/:userId", authenticateToken, languageValidator, async (req, res) => {
  const { userId } = req.params;
  const { role, lg } = req.body;
  const authData = { ...req.auth, lg };
  updateUserRole(userId, role, authData)
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
 * @description This route is used to get the user table data.
 */
userRouter.post(
  "/table-data",
  authenticateToken,
  paginationData,
  async (req, res) => {
    const { paginationData } = req.body;
    const authData = { ...req.auth, lg: paginationData.lg || 'en' };

    getUserTableData(paginationData, authData)
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
  }
);

/**
 * @description This route is used to return user list.
 * It requires the user to be authenticated.
 */
userRouter.post("/user-list", authenticateToken, languageValidator, async (req, res) => {
  const { lg } = req.body;
  getUserListData({ ...req.auth, lg })
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
 * @description This route is used to change user password.
 * It requires the user to be authenticated.
 */
userRouter.post("/change-password", authenticateToken, languageValidator, async (req, res) => {
  const { oldPassword, newPassword, lg } = req.body;
  const authData = { ...req.auth, lg };
  changeUserPassword(oldPassword, newPassword, authData)
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
 * @description What deleting this account would destroy (confirmation dialog).
 */
userRouter.post("/account/deletion-summary", authenticateToken, languageValidator, async (req, res) => {
  getAccountDeletionSummary({ ...req.auth, lg: req.body.lg })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Permanently delete the authenticated account. Requires the
 * password. Owned workspaces are deleted (subscriptions cancelled); joined
 * workspaces just lose the membership.
 */
userRouter.post("/account/delete", authenticateToken, languageValidator, async (req, res) => {
  deleteAccount(req.body?.password, { ...req.auth, lg: req.body.lg })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description List the workspaces (tenants) the authenticated account belongs to.
 */
userRouter.get("/workspaces", authenticateToken, async (req, res) => {
  getWorkspaces({ ...req.auth, lg: req.query.lg || "en" })
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Check if a subdomain is valid and available (live form feedback).
 */
userRouter.get("/workspaces/check-subdomain", authenticateToken, async (req, res) => {
  checkSubdomain(req.query.subdomain, req.query.lg || "en")
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({ status, message, data: result });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({ status, message });
    });
});

/**
 * @description Create a new workspace owned by the authenticated account.
 */
userRouter.post(
  "/workspaces/create",
  authenticateToken,
  languageValidator,
  async (req, res) => {
    const { workspaceData, lg } = req.body;
    createWorkspace(workspaceData, { ...req.auth, lg })
      .then((data) => {
        const { statusCode, status, message, result } = data;
        return res.status(statusCode).send({ status, message, data: result });
      })
      .catch((error) => {
        const { statusCode, status, message } = error;
        return res.status(statusCode).send({ status, message });
      });
  }
);

/**
 * @description Switch the active workspace; returns a fresh token for the target.
 */
userRouter.post(
  "/workspaces/switch",
  authenticateToken,
  languageValidator,
  async (req, res) => {
    const { tenantId, lg } = req.body;
    switchWorkspace(tenantId, { ...req.auth, lg })
      .then((data) => {
        const { statusCode, status, message, result } = data;
        return res.status(statusCode).send({ status, message, data: result });
      })
      .catch((error) => {
        const { statusCode, status, message } = error;
        return res.status(statusCode).send({ status, message });
      });
  }
);

module.exports = {
  userRouter,
};
