const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const createRoadmapColumn = async (columnData, authData) => {
  const { name, columnKey, sortOrder } = columnData;
  const { tenantId, lg } = authData;
  const _query = 'INSERT INTO roadmap_columns (tenant_id, name, column_key, sort_order) VALUES (?, ?, ?, ?)';
  try {
    const [result] = await pool.query(_query, [tenantId, name, columnKey, sortOrder || 0]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'roadmap_column_created_successfully', lg, { id: result.insertId }));
  } catch (error) {
    console.error('Error creating roadmap column:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_create_roadmap_column', lg));
  }
};
module.exports = { createRoadmapColumn };
