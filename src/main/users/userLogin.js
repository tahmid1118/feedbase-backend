const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { startSession } = require('../../common/sessions');


const parseTenantId = (tenantId) => {
    if (tenantId === undefined || tenantId === null || tenantId === '') {
        return null;
    }
    const parsedTenantId = Number(tenantId);
    if (!Number.isInteger(parsedTenantId) || parsedTenantId <= 0) {
        return null;
    }
    return parsedTenantId;
};


/**
 * Queries the database for a user by email and returns user info or status code.
 * @param {string} email - The user's email address.
 * @param {number|null} tenantId - Optional tenant id to scope login.
 * @returns {Promise<Object|number|boolean>} User info object if found and active, 2 if pending, 0 if inactive, false if not found.
 */
const userLoginQuery = async (email, tenantId = null) => {
    const isTenantScoped = Number.isInteger(tenantId);

    const _query = `
        SELECT
            id,
            tenant_id,
            full_name,
            email,
            role,
            password_hash,
            avatar_url
        FROM
            users
        WHERE
            email = ?
            ${isTenantScoped ? 'AND tenant_id = ?' : ''}
            AND is_active = 1
        LIMIT 1;
        `;

    try {
        const values = isTenantScoped ? [email, tenantId] : [email];
        const [rows] = await pool.query(_query, values);
        if (rows.length > 0) {
            return Promise.resolve(rows[0]);
        }
        return false;
    } catch (error) {
        return Promise.reject(error);
    }
}


/**
 * Generates a JWT token for the given user info.
 * @param {{ id: number, email: string }} userInfo - The user information for the token payload.
 * @param {string} sid - The device-session id this token belongs to.
 * @returns {string} The generated JWT token.
 * @description This function will generate a unique user token.
 */
const generateToken = (userInfo, sid) => {
    const token = jwt.sign(
        {
            id: userInfo.id,
            email: userInfo.email,
            tenantId: userInfo.tenant_id,
            role: userInfo.role,
            sid,
        },
        process.env.SECRET_ACCESS_TOKEN,
        {
            expiresIn: process.env.ACCESS_TOKEN_EXPIRE,
        }
    );

    return token;
};


/**
 * Handles user login by validating credentials and returning a server response with a token on success.
 * @param {{ lg: string, email: string, password: string }} userData - The user login data.
 * @param {string} lg
 * @param {object} [req] - Express request, used to record the device (UA/IP).
 * @returns {Promise<Object>} The server response indicating success or failure, with a token and user info on success.
 * @description This function handles user login by validated user data.
 */
const userLogin = async (userData, lg, req) => {
    let userInfo;
    const language = userData?.lg || lg || 'en';
    const tenantId = parseTenantId(userData?.tenantId);

    try {
        userInfo = await userLoginQuery(userData.email, tenantId);
    } catch (error) {
        console.error('Error querying user:', error);
        return Promise.reject(
            setServerResponse(
                API_STATUS_CODE.BAD_REQUEST,
                'invalid_email_or_password',
                language,
            )
        );
    }

    if (userInfo === false) {
        return Promise.reject(
            setServerResponse(
                API_STATUS_CODE.BAD_REQUEST,
                'invalid_email_or_password',
                language,
            )
        );
    }

    let isPasswordCorrect;
    try {
        isPasswordCorrect = await bcrypt.compare(
            userData.password,
            userInfo.password_hash
        ); //compare user passwords
    } catch (error) {
        console.error('Password comparison error:', error);
        return Promise.reject(
            setServerResponse(
                API_STATUS_CODE.BAD_REQUEST,
                'invalid_email_or_password',
                language,
            )
        );
    }
    if (isPasswordCorrect === false) {
        return Promise.reject(
            setServerResponse(
                API_STATUS_CODE.BAD_REQUEST,
                'invalid_email_or_password',
                language,
            )
        );
    }
    // One device at a time (Free/Pro): refuse a second login while another
    // device still holds a live session. Business plans skip this entirely.
    const session = await startSession(userInfo, req);
    if (session.blocked) {
        return Promise.reject(
            setServerResponse(
                API_STATUS_CODE.CONFLICT,
                'already_logged_in_elsewhere',
                language,
            )
        );
    }

    const token = generateToken(userInfo, session.sessionId);
    const user = {
        token: token,
        id: userInfo.id,
        tenantId: userInfo.tenant_id,
        fullName: userInfo.full_name,
        email: userInfo.email,
        role: userInfo.role,
        imageUrl: userInfo.avatar_url,
    }

    return Promise.resolve(
        setServerResponse(
            API_STATUS_CODE.OK,
            'user_logged_in_successfully',
            language,
            user
        )
    );
}

module.exports = {
    userLogin
};