const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getTagList = async (authData) => {
  const { tenantId, lg } = authData;
  const _query = 'SELECT * FROM tags WHERE tenant_id = ? ORDER BY name ASC';
  try {
    const [rows] = await pool.query(_query, [tenantId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'tags_retrieved_successfully', lg, rows));
  } catch (error) {
    console.error('Error getting tags:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_tags', lg));
  }
};
module.exports = { getTagList };
