const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { setServerResponse } = require("../../common/setServerResponse");
const { API_STATUS_CODE } = require("../../consts/errorStatus");



/**
 * Processes and stores an uploaded image, returning its relative path.
 *
 * This is a GENERIC uploader (used for profile avatars AND the tenant/company
 * logo in Branding). It only saves the file and returns the path — it must NOT
 * touch the user's `avatar_url`, otherwise uploading a company logo would
 * overwrite the uploader's profile photo (which then leaks into the header).
 * The avatar is set separately by the profile update (`updateUserData` with
 * `avatarUrl`); the logo is saved as the tenant's `branding_logo_url`.
 *
 * @param {Buffer} buffer - The image buffer to be processed and saved.
 * @param {object} _authData - Authenticated user (unused; kept for the route signature).
 * @param {string} lgKey - The language key for localization.
 * @returns {Promise<Object>} Server response with the relative file path on success.
 */
const insertImageData = async (buffer, _authData, lgKey) => {
    const fileName = `image-${Date.now()}.jpeg`;
    const relativePath = `uploads/profile-images/${fileName}`;
    const absolutePath = path.join(process.cwd(), relativePath);

    try {
        const resizeImage = await sharp(buffer)
            .resize(700, 700)
            .jpeg({ mozjpeg: true })
            .toBuffer();

        fs.writeFileSync(absolutePath, resizeImage);

        return Promise.resolve(
            setServerResponse(
                API_STATUS_CODE.OK,
                'image_uploaded_successfully',
                lgKey,
                relativePath
            )
        );
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
