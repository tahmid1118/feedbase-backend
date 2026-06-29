const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const bcrypt = require("bcrypt");
const { placeholderImagePath } = require("../../consts/staticValues");

// Identity is the email, so a signup is a duplicate if the email exists in ANY
// workspace (or as a pending account).
const checkDuplicateEmail = async (email) => {
  const _query = `SELECT id FROM users WHERE email = ? LIMIT 1;`;
  try {
    const [result] = await pool.query(_query, [email]);
    return result.length > 0;
  } catch (error) {
    console.error('Error checking duplicate email:', error);
    return Promise.reject(error);
  }
};
// New signups have NO workspace yet (tenant_id NULL); they create their first
// workspace during onboarding, which claims this row as the owner.
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
    VALUES (NULL, ?, ?, ?, ?, 'user', ?, 1);
`;

  const _values = [
    userData.fullName,
    userData.email,
    userData.contact || null,
    userData.password,
    placeholderImagePath,
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

  try {
    const isDuplicateEmail = await checkDuplicateEmail(userData.email);
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
