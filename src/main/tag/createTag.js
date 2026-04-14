const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const createTag = async (tagData, authData) => {
  const { name, colorHex } = tagData;
  const { tenantId, lg } = authData;
  const _query = 'INSERT INTO tags (tenant_id, name, color_hex) VALUES (?, ?, ?)';
  try {
    const [result] = await pool.query(_query, [tenantId, name, colorHex || null]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'tag_created_successfully', lg, { id: result.insertId }));
  } catch (error) {
    console.error('Error creating tag:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_create_tag', lg));
  }
};
module.exports = { createTag };
