const express = require('express');
const { authenticateToken } = require('../../middlewares/jwt/jwt');
const { checkIfFileSavePathExist } = require('../../common/file-upload/check-file-path-exist');
const { uploadImageValidator } = require('../../common/file-upload/upload-image-validator');
const { errorCheck } = require('../../common/file-upload/check-error');
const { insertImageData } = require('../../main/upload-files/upload-profile-image-info');
const fileUploadRouter = express.Router();


fileUploadRouter.use(authenticateToken);


/**
 * @description This API is used to upload profile images
 */
fileUploadRouter.post('/upload-image',
    checkIfFileSavePathExist,
    uploadImageValidator.single('upload_image'),
    errorCheck,
    async (req, res) => {
        const buffer = req.file?.buffer;
        const { lg } = req.body;

        insertImageData(buffer, req.auth, lg)
            .then((data) => {
                const { statusCode, status, message, result } = data;
                return res.status(statusCode).send({
                    status: status,
                    message: message,
                    filePath: result
                });
            })
            .catch((error) => {
                console.error('Image upload error:', error);
                const { statusCode, status, message } = error;
                return res.status(statusCode).send({
                    status: status,
                    message: message,
                });
            });
    })


module.exports = {
    fileUploadRouter
}