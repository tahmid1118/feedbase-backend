const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getChangelogList = async (paginationData, authData) => {
  const { tenantId, lg } = authData;
  const sortOrder = paginationData?.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const filterBy = (paginationData?.filterBy || '').trim();
  const itemsPerPage = Number(paginationData?.itemsPerPage) || 10;
  const offset = Number(paginationData?.offset) || 0;

  let _query = 'SELECT c.*, u.full_name as created_by_name FROM changelog_entries c LEFT JOIN users u ON c.created_by = u.id WHERE c.tenant_id = ?';
  const _values = [tenantId];

  if (filterBy) {
    _query += ' AND (c.title LIKE ? OR c.summary LIKE ? OR c.content LIKE ?)';
    const likeText = `%${filterBy}%`;
    _values.push(likeText, likeText, likeText);
  }

  _query += ` ORDER BY c.created_at ${sortOrder} LIMIT ? OFFSET ?`;
  _values.push(itemsPerPage, offset);

  try {
    const [rows] = await pool.query(_query, _values);
    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM changelog_entries WHERE tenant_id = ?', [tenantId]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'changelogs_retrieved_successfully', lg, { changelogs: rows, total: countResult[0].total }));
  } catch (error) {
    console.error('Error getting changelogs:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_changelogs', lg));
  }
};
module.exports = { getChangelogList };
