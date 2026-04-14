const { setServerResponse } = require("../../common/setServerResponse");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { pool } = require("../../../database/dbPool");

const totalUserTableRowCount = async (tenantId, filterBy) => {
  const searchText = (filterBy || '').trim();
  let _query = `
        SELECT
            COUNT(*) AS totalRows
        FROM
            users
        WHERE
            tenant_id = ?
    `;
  const _values = [tenantId];

  if (searchText) {
    _query += `
        AND (
            full_name LIKE ? OR
            email LIKE ?
        )
    `;
    const likeValue = `%${searchText}%`;
    _values.push(likeValue, likeValue);
  }

  try {
    const [rows] = await pool.query(_query, _values);
    if (rows.length > 0) {
      return Promise.resolve(rows[0].totalRows);
    }
    return Promise.resolve(0);
  } catch (error) {
    console.error('Error getting total user table row count:', error);
    return Promise.reject(error);
  }
};

const getUserTableDataQuery = async (paginationData) => {
  const sortOrder = paginationData.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const searchText = (paginationData.filterBy || '').trim();

  let _query = `
    SELECT
      id AS user_id,
      full_name,
      email,
      role,
      avatar_url,
      created_at,
      updated_at
    FROM
      users
    WHERE
      tenant_id = ?
  `;
  const _values = [paginationData.tenantId];

  if (searchText) {
  _query += `
    AND (
      full_name LIKE ? OR
      email LIKE ?
    )
  `;
  const likeValue = `%${searchText}%`;
  _values.push(likeValue, likeValue);
  }

  _query += `
    ORDER BY
      created_at ${sortOrder}
    LIMIT ? OFFSET ?;
  `;
  _values.push(paginationData.itemsPerPage, paginationData.offset);

  try {
    const [rows] = await pool.query(_query, _values);
    return Promise.resolve(rows);
  } catch (error) {
    console.error('Error getting user table data query:', error);
    return Promise.reject(error);
  }
};

const getUserTableData = async (paginationData, authData) => {
  const language = paginationData.lg || authData?.lg || 'en';
  const tenantId = authData?.tenantId;

  if (!tenantId) {
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.BAD_REQUEST,
        'user_not_found',
        language
      )
    );
  }

  try {
    const _paginationData = {
      ...paginationData,
      tenantId,
    };
    const totalRows = await totalUserTableRowCount(tenantId, _paginationData.filterBy);
    const userData = await getUserTableDataQuery(_paginationData);

    const result = {
      metadata: {
        totalRows: totalRows,
      },
      tableData: userData,
    };
    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        'user_data_fetched_successfully',
        language,
        result
      )
    );
  } catch (error) {
    console.error('Get user table data error:', error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        'internal_server_error',
        language
      )
    );
  }
};

module.exports = {
  getUserTableData,
};
