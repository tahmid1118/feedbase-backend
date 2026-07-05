const express = require("express");
const adminRouter = express.Router();

const { languageValidator } = require("../../middlewares/common/languageValidator");
const { adminLogin } = require("../../main/admin/adminLogin");

/** Standard { status, message, data } response shape. */
function send(res, data, key = "data") {
  const { statusCode, status, message, result } = data;
  const body = { status, message };
  if (result !== undefined) body[key] = result;
  return res.status(statusCode).send(body);
}

/**
 * @description Platform admin login (separate identity from tenant users).
 * POST /admin/auth/login  { lg, userData: { email, password } }
 */
adminRouter.post("/auth/login", languageValidator, async (req, res) => {
  const { userData = {}, lg } = req.body;
  adminLogin(userData, lg)
    .then((data) => send(res, data, "admin"))
    .catch((error) => send(res, error));
});

module.exports = { adminRouter };
