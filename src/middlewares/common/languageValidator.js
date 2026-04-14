const _ = require("lodash");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * Middleware to validate language parameter
 * Checks if language (lg) is provided in the request body or query
 */
const languageValidator = (req, res, next) => {
  const lg = req.body?.lg || req.query?.lg;

  // Check if language is provided
  if (_.isEmpty(lg)) {
    return res
      .status(API_STATUS_CODE.BAD_REQUEST)
      .send(
        setServerResponse(
          API_STATUS_CODE.BAD_REQUEST,
          'language_is_required',
          'en'
        )
      );
  }

  // Store the language in the request for easy access
  req.language = lg;
  next();
};

module.exports = {
  languageValidator,
};
