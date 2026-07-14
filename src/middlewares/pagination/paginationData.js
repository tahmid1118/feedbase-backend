const { setServerResponse } = require("../../common/setServerResponse");
const { API_STATUS_CODE } = require("../../consts/errorStatus");

/**
 * Middleware to validate and normalize pagination data from the request body.
 *
 * Expects req.body.paginationData to contain:
 *   - itemsPerPage: integer, number of items per page
 *   - currentPageNumber: integer, current page index (zero-based)
 *   - sortOrder: 'asc' or 'desc'
 *   - filterBy: optional filter string
 *
 * Validates types and values, sets defaults if missing, and calculates offset.
 * On validation error, responds with BAD_REQUEST and a standardized error message.
 * On success, updates req.body.paginationData and calls next().
 */
const paginationData = (req, res, next) => {
  const itemsPerPageDefault = 5;
  const currentPageNumberDefault = 0;
  const filterBy = "";
  const sortOrder = "desc";
  const language = req.body.lg || 'en';
  const _itemsPerPage = req.body.paginationData.itemsPerPage;
  const _currentPageNumber = req.body.paginationData.currentPageNumber;
  const _sortOrder = req.body.paginationData.sortOrder;
  const _filterBy = req.body.paginationData.filterBy;
  // Board sort (newest | oldest | most_voted | least_voted). This middleware
  // REBUILDS paginationData, so anything not carried over here is silently
  // dropped before it reaches the handler.
  const _sortBy = req.body.paginationData.sortBy;
  const errors = [];

  if (isNaN(_itemsPerPage)) {
    errors.push("itemsPerPage must be a integer value");
  }
  if (isNaN(_currentPageNumber)) {
    errors.push("currentPageNumber must be a integer value");
  }
  const itemsPerPage = parseInt(_itemsPerPage);
  const currentPageNumber = parseInt(_currentPageNumber);

  if (itemsPerPage < 0) {
    errors.push("itemsPerPage must be a positive integer value");
  }
  if (currentPageNumber < 0) {
    errors.push("currentPageNumber must be a positive integer value");
  }
  if (_sortOrder !== "asc" && _sortOrder !== "desc") {
    errors.push("sortOrder - has to be either asc or desc");
  }
  // console.log('errors: ', errors);
  // return
  if (errors.length >= 1) {
    return res
      .status(API_STATUS_CODE.BAD_REQUEST)
      .send(
        setServerResponse(
          API_STATUS_CODE.BAD_REQUEST,
          "invalid_pagination_data",
          language
        )
      );
  }

  const paginationData = {
    itemsPerPage: itemsPerPage || itemsPerPageDefault,
    currentPageNumber: currentPageNumber || currentPageNumberDefault,
    filterBy: _filterBy || filterBy,
    sortOrder: _sortOrder || sortOrder,
    lg: language,
  };
  req.body.paginationData = {
    ...paginationData,
    ...(_sortBy ? { sortBy: _sortBy } : {}),
    offset: paginationData.itemsPerPage * paginationData.currentPageNumber,
  };
  // console.log(paginationData);
  next();
};
module.exports = {
  paginationData,
};
