const { planAllows } = require("../../common/planGuard");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * Gate an upload on the workspace's plan BEFORE multer runs, so a Free workspace
 * never streams a 50MB video only to be rejected. Attachments are a Pro+
 * capability (`limits.attachments`).
 */
const rejectFree = (res, lg) => {
  const data = setServerResponse(
    API_STATUS_CODE.PAYMENT_REQUIRED,
    "plan_limit_attachments",
    lg
  );
  return res.status(data.statusCode).send({
    status: data.status,
    message: data.message,
  });
};

/** For authenticated dashboard uploads — tenant comes from the token. */
const requireAttachmentsAuthed = async (req, res, next) => {
  const lg = req.body?.lg || req.query?.lg || "en";
  try {
    if (await planAllows(req.auth.tenantId, "attachments")) return next();
    return rejectFree(res, lg);
  } catch (error) {
    console.error("requireAttachmentsAuthed error:", error);
    return rejectFree(res, lg);
  }
};

/** For public portal uploads — tenant comes from `attachPublicTenant`. */
const requireAttachmentsPublic = async (req, res, next) => {
  const lg = req.lg || req.body?.lg || "en";
  try {
    if (await planAllows(req.publicTenant.id, "attachments")) return next();
    return rejectFree(res, lg);
  } catch (error) {
    console.error("requireAttachmentsPublic error:", error);
    return rejectFree(res, lg);
  }
};

module.exports = { requireAttachmentsAuthed, requireAttachmentsPublic };
