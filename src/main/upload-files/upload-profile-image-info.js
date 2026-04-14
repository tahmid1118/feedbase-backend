

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { pool } = require('../../../database/dbPool');
const { setServerResponse } = require("../../common/setServerResponse");
const { API_STATUS_CODE } = require("../../consts/errorStatus");



/**
 * Updates the user's image URL and last updated timestamp in the database.
 *
 * @param {{ id: number, email: string, role: string }} authData - Authenticated user data containing user ID.
 * @param {{ filePath: string, updatedAt: Date }} bodyData - Data containing the new image file path and update timestamp.
 * @returns {Promise<boolean>} - Resolves to true if the update was successful, false otherwise. Rejects with error on failure.
 */
const insertImageDataQuery = async (authData, bodyData) => {
    const _query = `
        UPDATE 
            users
        SET
            avatar_url = ?,
            updated_at = ?
        WHERE
            id = ? AND
            tenant_id = ?;
    `;
    const _values = [
        bodyData.filePath,
        bodyData.updatedAt,
        authData.id,
        authData.tenantId
    ]

    try {
        const [result] = await pool.query(_query, _values);
        if (result.affectedRows > 0) {
            return true;
        } return false;
    } catch (error) {
        return Promise.reject(error);
    }
}

/**
 * Processes and saves a image, then updates the user's image path in the database.
 * @param {Buffer} buffer - The image buffer to be processed and saved.
 * @param {{ id: number, email: string, role: string }} authData - The authenticated user data.
 * @param {string} lgKey - The language key for localization.
 * @returns {Promise<Object>} The server response indicating success or failure, with the file path on success.
 * @description This function resizes, saves the uploaded image, and updates the user's image path in the database.
 */
const insertImageData = async (buffer, authData, lgKey) => {
    const fileName = `image-${Date.now()}.jpeg`;
    const relativePath = `uploads/profile-images/${fileName}`;
    const absolutePath = path.join(process.cwd(), relativePath);
    const updatedAt = new Date();
    const bodyData = { filePath: relativePath, updatedAt: updatedAt }

    try {
        const resizeImage = await sharp(buffer)
            .resize(700, 700)
            .jpeg({ mozjpeg: true })
            .toBuffer();

        fs.writeFileSync(absolutePath, resizeImage);

        const isInsert = await insertImageDataQuery(authData, bodyData);
        if (isInsert) {
            return Promise.resolve(
                setServerResponse(
                    API_STATUS_CODE.OK,
                    'image_uploaded_successfully',
                    lgKey,
                    relativePath
                )
            )
        } else {
            return Promise.reject(
                setServerResponse(
                    API_STATUS_CODE.BAD_REQUEST,
                    'failed_to_upload_image',
                    lgKey,
                )
            );
        }
    } catch (error) {
        console.error('Image upload error:', error);
        return Promise.reject(
            setServerResponse(
                API_STATUS_CODE.INTERNAL_SERVER_ERROR,
                'internal_server_error',
                lgKey,
            )
        );
    }
}

module.exports = {
    insertImageData
}