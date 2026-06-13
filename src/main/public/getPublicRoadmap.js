const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * @description Public roadmap (columns + items) for a tenant, returned together
 * so the portal can render the board in a single request.
 * @param {number} tenantId
 * @param {string} lg
 */
const getPublicRoadmap = async (tenantId, lg) => {
  const _columnsQuery =
    "SELECT id, name, column_key, sort_order FROM roadmap_columns WHERE tenant_id = ? ORDER BY sort_order ASC";

  const _itemsQuery = `
    SELECT ri.id, ri.post_id, ri.roadmap_column_id, ri.sort_order,
           ri.target_release_date, p.title, p.status, p.post_type,
           rc.name AS column_name,
           (SELECT COUNT(*) FROM votes WHERE post_id = ri.post_id) AS vote_count
    FROM roadmap_items ri
    LEFT JOIN posts p ON ri.post_id = p.id
    LEFT JOIN roadmap_columns rc ON ri.roadmap_column_id = rc.id
    WHERE ri.tenant_id = ?
    ORDER BY ri.sort_order ASC
  `;

  try {
    const [columns] = await pool.query(_columnsQuery, [tenantId]);
    const [items] = await pool.query(_itemsQuery, [tenantId]);

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        "roadmap_items_retrieved_successfully",
        lg,
        { columns, items }
      )
    );
  } catch (error) {
    console.error("Error getting public roadmap:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_get_roadmap_items",
        lg
      )
    );
  }
};

module.exports = { getPublicRoadmap };
