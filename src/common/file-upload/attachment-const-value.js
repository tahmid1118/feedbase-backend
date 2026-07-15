const path = require("path");

/** Where post attachments are written (served statically under /uploads). */
const attachmentDir = path.join(process.cwd(), "/uploads/attachments");

/** Allowed image mimetypes → stored with kind 'image'. */
const imageMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
];

/** Allowed video mimetypes → stored with kind 'video'. */
const videoMimeTypes = [
  "video/mp4",
  "video/webm",
  "video/quicktime", // .mov
];

const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 50 MB — "short" is enforced by size

/** Hard multer ceiling; the per-kind caps above are checked in the handler. */
const ATTACHMENT_MAX_BYTES = VIDEO_MAX_BYTES;

/** Most attachments allowed on a single post. */
const MAX_ATTACHMENTS_PER_POST = 3;

/** Map a mimetype to our stored kind, or null if it's not an allowed type. */
const kindForMime = (mime) => {
  if (imageMimeTypes.includes(mime)) return "image";
  if (videoMimeTypes.includes(mime)) return "video";
  return null;
};

module.exports = {
  attachmentDir,
  imageMimeTypes,
  videoMimeTypes,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  ATTACHMENT_MAX_BYTES,
  MAX_ATTACHMENTS_PER_POST,
  kindForMime,
};
