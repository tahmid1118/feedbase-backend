const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * @description Public changelog list — only published entries are exposed.
 */
const getPublicChangelogList = async (tenantId, paginationData, lg) => {
  const sortOrder = paginationData?.sortOrder === "asc" ? "ASC" : "DESC";
  const itemsPerPage = Number(paginationData?.itemsPerPage) || 20;
  const offset = Number(paginationData?.offset) || 0;

  const _query = `
    SELECT c.id, c.title, c.summary, c.content, c.is_published,
           c.published_at, c.created_at, u.full_name AS created_by_name
    FROM changelog_entries c
    LEFT JOIN users u ON c.created_by = u.id
    WHERE c.tenant_id = ? AND c.is_published = 1
    ORDER BY COALESCE(c.published_at, c.created_at) ${sortOrder}
    LIMIT ? OFFSET ?
  `;

  const _countQuery =
    "SELECT COUNT(*) AS total FROM changelog_entries WHERE tenant_id = ? AND is_published = 1";

  try {
    const [rows] = await pool.query(_query, [tenantId, itemsPerPage, offset]);
    const [countResult] = await pool.query(_countQuery, [tenantId]);

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        "changelogs_retrieved_successfully",
        lg,
        { changelogs: rows, total: countResult[0].total }
      )
    );
  } catch (error) {
    console.error("Error getting public changelogs:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_get_changelogs",
        lg
      )
    );
  }
};

/**
 * @description Public changelog detail — only resolves published entries.
 */
const getPublicChangelogDetail = async (tenantId, changelogId, lg) => {
  const _query = `
    SELECT c.id, c.title, c.summary, c.content, c.is_published,
           c.published_at, c.created_at, u.full_name AS created_by_name
    FROM changelog_entries c
    LEFT JOIN users u ON c.created_by = u.id
    WHERE c.id = ? AND c.tenant_id = ? AND c.is_published = 1
  `;

  try {
    const [rows] = await pool.query(_query, [changelogId, tenantId]);

    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "changelog_not_found", lg)
      );
    }

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        "changelog_retrieved_successfully",
        lg,
        rows[0]
      )
    );
  } catch (error) {
    console.error("Error getting public changelog:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_get_changelog",
        lg
      )
    );
  }
};

module.exports = { getPublicChangelogList, getPublicChangelogDetail };
