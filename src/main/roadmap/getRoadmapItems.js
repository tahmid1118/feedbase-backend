const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getRoadmapItems = async (authData) => {
  const { tenantId, lg } = authData;
  const _query = 'SELECT ri.*, p.title, p.description, rc.name as column_name FROM roadmap_items ri LEFT JOIN posts p ON ri.post_id = p.id LEFT JOIN roadmap_columns rc ON ri.roadmap_column_id = rc.id WHERE ri.tenant_id = ? ORDER BY ri.sort_order ASC';
  try {
    const [rows] = await pool.query(_query, [tenantId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'roadmap_items_retrieved_successfully', lg, rows));
  } catch (error) {
    console.error('Error getting roadmap items:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_roadmap_items', lg));
  }
};
module.exports = { getRoadmapItems };
