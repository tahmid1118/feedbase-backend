const _ = require("lodash");
const { format } = require("date-fns");
const { setServerResponse } = require("../../common/setServerResponse");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const bcrypt = require("bcrypt");
const { pool } = require("../../../database/dbPool");

const getUserInfo = async (authData) => {
  const _query = `
        SELECT
            id,
            password_hash
        FROM
           users
        WHERE
            id = ? AND
            tenant_id = ? AND
            is_active = 1
    `;
  try {
    const [row] = await pool.query(_query, [authData.id, authData.tenantId]);
    if (row.length > 0) {
      return row[0];
    }
    return false;
  } catch (error) {
    console.error('Error getting user info:', error);
    return Promise.reject(error);
  }
};

const updateUserPasswordQuery = async (userId, tenantId, hashPassword, updatedAt) => {
  const _query = `
        UPDATE
            users
        SET
            password_hash = ?,
            updated_at = ?
        WHERE
            id = ? AND tenant_id = ?;
    `;
  try {
    const [result] = await pool.query(_query, [
      hashPassword,
      updatedAt,
      userId,
      tenantId,
    ]);
    return result.affectedRows > 0 ? true : false;
  } catch (error) {
    console.error('Error updating user password:', error);
    return Promise.reject(error);
  }
};

const changeUserPassword = async (oldPassword, newPassword, authData) => {
  let hashPassword;
  const updatedAt = format(new Date(), "yyyy-MM-dd HH:mm:ss");
  const language = authData.lg || 'en';
  try {
    if (_.isEmpty(oldPassword) || _.isEmpty(newPassword)) {
      return Promise.reject(
        setServerResponse(
          API_STATUS_CODE.BAD_REQUEST,
          'old_password_and_new_password_is_required',
          language
        )
      );
    }
    const userInfo = await getUserInfo(authData);
    if (userInfo === false) {
      return Promise.reject(
        setServerResponse(
          API_STATUS_CODE.BAD_REQUEST,
          'user_not_found',
          language
        )
      );
    }
    const isPasswordCorrect = await bcrypt.compare(
      oldPassword,
      userInfo.password_hash
    );
    if (isPasswordCorrect === true) {
      hashPassword = await bcrypt.hash(newPassword, 10);
    } else {
      return Promise.reject(
        setServerResponse(
          API_STATUS_CODE.BAD_REQUEST,
          'password_mismatched',
          language
        )
      );
    }
    const isUpdated = await updateUserPasswordQuery(
      authData.id,
      authData.tenantId,
      hashPassword,
      updatedAt
    );
    if (isUpdated === true) {
      return Promise.resolve(
        setServerResponse(
          API_STATUS_CODE.OK,
          'password_updated_successfully',
          language
        )
      );
    } else {
      return Promise.reject(
        setServerResponse(
          API_STATUS_CODE.BAD_REQUEST,
          'failed_to_change_password',
          language
        )
      );
    }
  } catch (error) {
    console.error('Change user password error:', error);
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
  changeUserPassword,
};
