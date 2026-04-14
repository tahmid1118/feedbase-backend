const express = require("express");
const userRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { paginationData } = require("../../middlewares/pagination/paginationData");
const { userLogin } = require("../../main/users/userLogin");
const { registerNewUser } = require("../../main/users/registerNewUser");
const { getPersonalData } = require("../../main/users/gerUserPersonalData");
const { getUserTableData } = require("../../main/users/getUserTableData");
const { getUserListData } = require("../../main/users/getUserListData");
const { updatePersonalInfo } = require("../../main/users/updateUserData");
const { changeUserPassword } = require("../../main/users/changeUserPassword");
const { updateUserRole } = require("../../main/users/updateUserRole");

/**
 * @description User login
 */
userRouter.post("/login", languageValidator, async (req, res) => {
  const { userData = {}, lg } = req.body;
  userLogin(userData, lg)
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

module.exports = {
  userRouter,
};
