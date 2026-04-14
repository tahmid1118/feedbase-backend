const { setServerResponse } = require("../../common/setServerResponse");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { pool } = require("../../../database/dbPool");

const getUserListDataQuery = async (tenantId) => {
  const _query = `
        SELECT
            id AS user_id,
            full_name,
            email,
            role,
            avatar_url
        FROM
            users
        WHERE
            tenant_id = ? AND
            is_active = 1
        ORDER BY
            created_at DESC;
    `;
  try {
    const [rows] = await pool.query(_query, [tenantId]);
    return rows;
  } catch (error) {
    console.error('Error getting user list data query:', error);
    return Promise.reject(error);
  }
};

const getUserListData = async (authData) => {
  const language = authData?.lg || 'en';
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
    const userList = await getUserListDataQuery(tenantId);
    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        'user_data_fetched_successfully',
        language,
        userList
      )
    );
  } catch (error) {
    console.error('Get user list data error:', error);
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
  getUserListData,
};
