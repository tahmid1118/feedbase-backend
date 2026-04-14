const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const createChangelog = async (changelogData, authData) => {
  const { title, summary, content } = changelogData;
  const { id: createdBy, tenantId, lg } = authData;
  const _query = 'INSERT INTO changelog_entries (tenant_id, title, summary, content, created_by) VALUES (?, ?, ?, ?, ?)';
  try {
    const [result] = await pool.query(_query, [tenantId, title, summary || null, content, createdBy]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'changelog_created_successfully', lg, { id: result.insertId }));
  } catch (error) {
    console.error('Error creating changelog:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_create_changelog', lg));
  }
};
module.exports = { createChangelog };
