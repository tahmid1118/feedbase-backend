

const path = require('path');


/**
 * @description Upload image saved file directory
 */
const imageDir = path.join(process.cwd(), "/uploads/profile-images");

/**
 * @description Upload image file mimetype
 *
 * Everything here is re-encoded to JPEG by sharp before it is written (see
 * `insertImageData`), so accepting a format costs nothing beyond sharp being
 * able to DECODE it — verified against the production sharp build
 * (0.35.3 / libvips 8.18.3): jpeg, png, webp, gif, avif and tiff all decode.
 *
 * `gif` was missing while the ATTACHMENT uploader
 * (`attachment-const-value.js`) already accepted it, so the same file was
 * fine on a feedback post and rejected as an avatar. `avif` is added because
 * current browsers and phones export it by default.
 *
 * Deliberately NOT accepted:
 *   - tiff: decodes fine, but is a historic source of libvips CVEs and nobody
 *     uploads a scan as an avatar. Not worth the parser surface.
 *   - svg: sharp would rasterise it safely, but a crafted SVG is a cheap DoS.
 *   - heic/heif: could not be verified on the production build, so it stays out
 *     rather than being advertised and failing.
 */
const fileTypes = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
];

/**
 * @description Upload file maximum size
 */
const uploadFileSize = 10240000; //10MB

module.exports = {
  imageDir,
  uploadFileSize,
  fileTypes,
};
