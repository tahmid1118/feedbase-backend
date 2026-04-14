const { setServerResponse } = require("../../common/setServerResponse");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { pool } = require("../../../database/dbPool");

const getUserPersonalData = async (authData) => {
  const _query = `
    SELECT
        id AS user_id,
        full_name,
        email,
        contact_no
    FROM
        users
    WHERE
        id = ? AND
        email = ? AND
        tenant_id = ? AND
        is_active = 1
`;

  const _values = [authData.id, authData.email, authData.tenantId];
  try {
    const [rows] = await pool.query(_query, _values);
    return rows[0];
  } catch (error) {
    console.error('Error getting user personal data:', error);
    return Promise.reject(error);
  }
};

const getPersonalData = async (authData) => {
  const language = authData.lg || 'en';
  try {
    const userData = await getUserPersonalData(authData);
    if (!userData) {
      return Promise.reject(
        setServerResponse(
          API_STATUS_CODE.BAD_REQUEST,
          'user_not_found',
          language
        )
      );
    }
    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        'data_fetched_successfully',
        language,
        userData
      )
    );
  } catch (error) {
    console.error('Get personal data error:', error);
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
  getPersonalData,
};
