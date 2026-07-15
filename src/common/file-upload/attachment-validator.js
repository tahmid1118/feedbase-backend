const multer = require("multer");
const {
  imageMimeTypes,
  videoMimeTypes,
  ATTACHMENT_MAX_BYTES,
} = require("./attachment-const-value");

/**
 * Multer middleware for a single post attachment (`file` field). Keeps the file
 * in memory so the handler can validate the per-kind size cap and write it under
 * a random name. Accepts images and video; the outer 50MB limit is the ceiling,
 * with the tighter 10MB image cap enforced in the handler.
 */
const attachmentValidator = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (
      imageMimeTypes.includes(file.mimetype) ||
      videoMimeTypes.includes(file.mimetype)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only images (PNG, JPG, WEBP, GIF) and video (MP4, WebM, MOV) are allowed!"));
    }
  },
  limits: { fileSize: ATTACHMENT_MAX_BYTES },
});

module.exports = { attachmentValidator };
