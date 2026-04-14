const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const bcrypt = require("bcrypt");
const { placeholderImagePath } = require("../../consts/staticValues");

const resolveTenantId = (tenantId) => {
  if (tenantId === undefined || tenantId === null || tenantId === '') {
    return 1;
  }

  const parsedTenantId = Number(tenantId);
  if (!Number.isInteger(parsedTenantId) || parsedTenantId <= 0) {
    return 1;
  }

  return parsedTenantId;
};

const checkDuplicateEmail = async (email, tenantId) => {
  const _query = `
    SELECT 
        email
    FROM
        users
    WHERE
        email = ? AND
        tenant_id = ?;
`;

  try {
    const [result] = await pool.query(_query, [email, tenantId]);
    if (result.length > 0) {
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error checking duplicate email:', error);
    return Promise.reject(error);
  }
};
const insertUserDataQuery = async (userData) => {
  const _query = `
    INSERT INTO users (
        tenant_id,
        full_name,
        email,
        contact_no,
        password_hash,
        role,
        avatar_url,
        is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;

  const _values = [
    userData.tenantId,
    userData.fullName,
    userData.email,
    userData.contact || null,
    userData.password,
    'user',
    placeholderImagePath,
    1,
  ];

  try {
    const [rows] = await pool.query(_query, _values);
    if (rows.affectedRows > 0) {
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error inserting user data:', error);
    return Promise.reject(error);
  }
};

const registerNewUser = async (userData, lg) => {
  const language = userData?.lg || lg || 'en';
  const tenantId = resolveTenantId(userData?.tenantId);

  try {
    const isDuplicateEmail = await checkDuplicateEmail(userData.email, tenantId);
    if (isDuplicateEmail) {
      return Promise.reject(
        setServerResponse(
          API_STATUS_CODE.BAD_REQUEST,
          'email_has_already_exist',
          language
        )
      );
    }

    // Hash the password from userData
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(userData.password, saltRounds);
    userData = {
      ...userData,
      tenantId,
      password: hashedPassword,
    };

    const insertedData = await insertUserDataQuery(userData);
    if (insertedData === true) {
      return Promise.resolve(
        setServerResponse(
          API_STATUS_CODE.OK,
          'sign_up_is_successful',
          language
        )
      );
    }
  } catch (error) {
    console.error('Register new user error:', error);
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
  registerNewUser,
};
