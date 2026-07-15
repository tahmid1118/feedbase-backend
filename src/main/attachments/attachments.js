const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const {
  attachmentDir,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  MAX_ATTACHMENTS_PER_POST,
  kindForMime,
} = require("../../common/file-upload/attachment-const-value");

const EXT_FOR_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

/** Public shape returned to clients (never the absolute disk path). */
const toPublic = (row) => ({
  id: row.id,
  kind: row.kind,
  url: row.storage_path,
  mime_type: row.mime_type,
  size_bytes: Number(row.size_bytes),
  original_name: row.original_name,
});

/**
 * Validate + persist one uploaded attachment for a tenant. Writes the file under
 * uploads/attachments/ and records a `post_attachments` row with post_id NULL —
 * the row is linked to its post later by `attachToPost`. Returns the public
 * attachment (incl. its id, which the client sends back on submit).
 *
 * @param {{ buffer: Buffer, mimetype: string, originalname?: string, size: number }} file
 * @param {number} tenantId
 * @param {string} lg
 */
const storeAttachment = async (file, tenantId, lg) => {
  if (!file || !file.buffer) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "attachment_required", lg)
    );
  }

  const kind = kindForMime(file.mimetype);
  if (!kind) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_attachment_type", lg)
    );
  }

  const size = file.size ?? file.buffer.length;
  const cap = kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  if (size > cap) {
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.BAD_REQUEST,
        kind === "image" ? "attachment_image_too_large" : "attachment_video_too_large",
        lg
      )
    );
  }

  const ext = EXT_FOR_MIME[file.mimetype] || "";
  const fileName = `att-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  const relativePath = `uploads/attachments/${fileName}`;
  const absolutePath = path.join(attachmentDir, fileName);

  try {
    fs.mkdirSync(attachmentDir, { recursive: true });
    fs.writeFileSync(absolutePath, file.buffer);

    const [result] = await pool.query(
      `INSERT INTO post_attachments
         (tenant_id, post_id, kind, storage_path, mime_type, size_bytes, original_name)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        kind,
        relativePath,
        file.mimetype,
        size,
        (file.originalname || "").slice(0, 255) || null,
      ]
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.CREATED, "attachment_uploaded", lg, {
        id: result.insertId,
        kind,
        url: relativePath,
        mime_type: file.mimetype,
        size_bytes: size,
      })
    );
  } catch (error) {
    console.error("storeAttachment error:", error);
    // Best-effort cleanup of a written file whose row failed to insert.
    try {
      fs.unlinkSync(absolutePath);
    } catch {
      /* ignore */
    }
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_upload_attachment",
        lg
      )
    );
  }
};

/**
 * Link previously-uploaded attachments to the post they were created with. Only
 * still-unlinked attachments in the SAME tenant are claimed (so an id can't be
 * hijacked onto another workspace's post), and no more than the per-post cap.
 * Best-effort: never throws — a bad id list must not fail the post creation.
 *
 * @param {import('mysql2/promise').Pool|import('mysql2/promise').PoolConnection} db
 * @param {Array<number|string>} attachmentIds
 * @param {number} postId
 * @param {number} tenantId
 * @returns {Promise<number>} how many were linked
 */
const attachToPost = async (db, attachmentIds, postId, tenantId) => {
  const ids = (Array.isArray(attachmentIds) ? attachmentIds : [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_ATTACHMENTS_PER_POST);

  if (ids.length === 0) return 0;

  try {
    const [r] = await db.query(
      `UPDATE post_attachments
          SET post_id = ?
        WHERE tenant_id = ? AND post_id IS NULL AND id IN (?)`,
      [postId, tenantId, ids]
    );
    return r.affectedRows || 0;
  } catch (error) {
    console.error("attachToPost error:", error);
    return 0;
  }
};

/** Attachments for a single post (ordered oldest-first). Public shape. */
const getAttachmentsForPost = async (postId, tenantId) => {
  const [rows] = await pool.query(
    `SELECT id, kind, storage_path, mime_type, size_bytes, original_name
       FROM post_attachments
      WHERE post_id = ? AND tenant_id = ?
      ORDER BY id ASC`,
    [postId, tenantId]
  );
  return rows.map(toPublic);
};

/** Attachments for many posts as a { [postId]: attachment[] } map. */
const getAttachmentsForPosts = async (postIds, tenantId) => {
  const ids = (postIds || []).map(Number).filter(Boolean);
  if (ids.length === 0) return {};
  const [rows] = await pool.query(
    `SELECT id, post_id, kind, storage_path, mime_type, size_bytes, original_name
       FROM post_attachments
      WHERE tenant_id = ? AND post_id IN (?)
      ORDER BY id ASC`,
    [tenantId, ids]
  );
  const map = {};
  for (const row of rows) {
    (map[row.post_id] ||= []).push(toPublic(row));
  }
  return map;
};

module.exports = {
  storeAttachment,
  attachToPost,
  getAttachmentsForPost,
  getAttachmentsForPosts,
};
