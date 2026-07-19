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
/**
 * Hard ceiling on page size. Without it a single request can ask for millions of
 * rows: the DB streams them, mysql2 buffers them all in memory, and the process
 * dies with an OOM. One crafted request should never be able to take the server
 * down, so this is a denial-of-service control, not a tuning knob.
 */
const MAX_ITEMS_PER_PAGE = Number(process.env.MAX_ITEMS_PER_PAGE) || 100;
/** Cap the page index too — a huge OFFSET makes MySQL walk the whole table. */
const MAX_PAGE_NUMBER = Number(process.env.MAX_PAGE_NUMBER) || 10000;

const paginationData = (req, res, next) => {
  const itemsPerPageDefault = 5;
  const currentPageNumberDefault = 0;
  const filterBy = "";
  const sortOrder = "desc";
  const language = req.body.lg || 'en';
  // Tolerate a missing paginationData object: reading `.itemsPerPage` off
  // undefined threw a TypeError, turning a malformed request into a 500.
  const incoming = req.body.paginationData || {};
  const _itemsPerPage = incoming.itemsPerPage;
  const _currentPageNumber = incoming.currentPageNumber;
  const _sortOrder = incoming.sortOrder;
  const _filterBy = incoming.filterBy;
  // Board sort (newest | oldest | most_voted | least_voted). This middleware
  // REBUILDS paginationData, so anything not carried over here is silently
  // dropped before it reaches the handler.
  const _sortBy = incoming.sortBy;
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

  // Clamp rather than reject: an over-large page size is far more often a lazy
  // client asking for "everything" than an attack, and silently serving the
  // maximum keeps those clients working while still bounding the blast radius.
  const safeItemsPerPage = Math.min(
    itemsPerPage || itemsPerPageDefault,
    MAX_ITEMS_PER_PAGE
  );
  const safePageNumber = Math.min(
    currentPageNumber || currentPageNumberDefault,
    MAX_PAGE_NUMBER
  );

  const paginationData = {
    itemsPerPage: safeItemsPerPage,
    currentPageNumber: safePageNumber,
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
