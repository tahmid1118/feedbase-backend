const { format } = require("date-fns");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

const checkUserExists = async (userId) => {
  const _query = `
        SELECT id
        FROM
            users
        WHERE
            id = ? AND
            is_active = 1;
    `;

  try {
    const [rows] = await pool.query(_query, [userId]);
    return rows.length > 0 ? true : false;
  } catch (error) {
    console.error('Error checking user exists:', error);
    return Promise.reject(error);
  }
};

const updateUserDataQuery = async (userData) => {
  let _query = `UPDATE users SET `;
  const _values = [];

  if (userData.fullName) {
    _query += `full_name = ? `;
    _values.push(userData.fullName);
  }

  if (userData.contact) {
    if (_values.length > 0) _query += ", ";
    _query += `contact_no = ? `;
    _values.push(userData.contact);
  }

  if (userData.imageUrl) {
    if (_values.length > 0) _query += ", ";
    _query += `avatar_url = ? `;
    _values.push(userData.imageUrl);
  }

  if (_values.length > 0) {
    _query += ", ";
    _query += `updated_at = ? `;
    _values.push(userData.updatedAt);
  }

  if (_values.length === 0) {
    return false;
  }

  // Final WHERE condition
  _query += ` WHERE id = ?`;
  _values.push(userData.userId);

  try {
    const [rows] = await pool.query(_query, _values);
    if (rows.affectedRows > 0) {
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error updating user data query:', error);
    return Promise.reject(error);
  }
};

const updatePersonalInfo = async (userData, authData) => {
  const updatedAt = format(new Date(), "yyyy-MM-dd HH:mm:ss");
  const language = authData?.lg || userData?.lg || 'en';
  const preparedData = {
    fullName: userData?.fullName,
    contact: userData?.contact,
    imageUrl: userData?.imageUrl || userData?.avatarUrl,
    updatedAt,
    // Always the authenticated user from the verified JWT — never trust a
    // client-supplied userId, which would allow editing another account.
    userId: authData?.id,
  };

  if (!preparedData.fullName && !preparedData.contact && !preparedData.imageUrl) {
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.BAD_REQUEST,
        'string_data_is_required',
        language
      )
    );
  }

  try {
    const isExist = await checkUserExists(preparedData.userId);
    if (isExist === false) {
      return Promise.resolve(
        setServerResponse(
          API_STATUS_CODE.BAD_REQUEST,
          'user_not_found',
          language
        )
      );
    }
    const isUpdated = await updateUserDataQuery(preparedData);
    if (isUpdated) {
      return Promise.resolve(
        setServerResponse(
          API_STATUS_CODE.OK,
          'profile_updated_successfully',
          language
        )
      );
    }

    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.BAD_REQUEST,
        'user_not_found',
        language
      )
    );
  } catch (error) {
    console.error('Update personal info error:', error);
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
  updatePersonalInfo,
};
