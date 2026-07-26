


const multer = require("multer");
const { fileTypes, uploadFileSize } = require("./upload-file-const-value");
const { imageStorage } = require("./image-name-modifiers");

/**
 * Multer middleware for validating and storing uploaded image files.
 *
 * - Stores images using custom imageStorage configuration.
 * - Only allows image files (PNG, JPEG, JPG, WEBP) as defined in fileTypes.
 * - Limits file size based on uploadFileSize constant.
 * - Returns an error if the file is not a valid image type.
 *
 * Use for endpoints that accept image uploads and require strict validation and naming conventions.
 */
const uploadImageValidator = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (fileTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            // Derive the list from fileTypes so the message can never drift from
            // what is actually accepted, and name the type that was rejected —
            // "Only image files are allowed" on a file the user believes IS an
            // image is impossible to act on.
            const allowed = fileTypes
                .map((t) => t.replace("image/", "").toUpperCase())
                .filter((t, i, a) => a.indexOf(t) === i)
                .join(", ");
            cb(
                new Error(
                    `${file.mimetype || "That file type"} is not supported. Allowed image types: ${allowed}.`
                )
            );
        }
    },
    limits: {
        fileSize: uploadFileSize,
    },
});

module.exports = {
    uploadImageValidator,
};
