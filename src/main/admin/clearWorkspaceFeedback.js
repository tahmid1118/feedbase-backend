const fs = require("fs");
const path = require("path");
const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { attachmentDir } = require("../../common/file-upload/attachment-const-value");

/**
 * Platform-admin action: delete EVERY feedback post in one workspace.
 *
 * This is the most destructive thing in the admin panel — it wipes a paying
 * customer's board, so the guard rails are part of the feature, not polish:
 *
 *   - **Typed confirmation, re-checked server-side.** The caller must send
 *     `confirm` equal to the workspace's own `subdomain`. The realistic
 *     accident here is an admin firing this at the wrong row, and a client-side
 *     dialog alone can't prevent that — so the server refuses a mismatch with
 *     400 and deletes nothing.
 *   - **Tenant-scoped in the statement itself** (`WHERE tenant_id = ?`), never
 *     by filtering ids fetched earlier.
 *
 * Dependents come out via the schema, not by hand: every FK referencing
 * `posts(id)` is ON DELETE CASCADE — comments, votes, post_tags,
 * roadmap_items, post_attachments — and `posts.duplicate_of_post_id` is SET
 * NULL. So one DELETE is both complete and atomic. Two consequences worth
 * knowing before running it: **roadmap items built from these posts go too**
 * (they cascade), while the **changelog is untouched** (it has no FK to posts).
 *
 * Attachment FILES are unlinked afterwards, best-effort. The rows cascade but
 * the bytes on disk would otherwise be orphaned forever — tolerable for the
 * single-post delete, a real leak when clearing a whole board. Only the
 * basename of each stored path is used and the result must resolve inside
 * `attachmentDir`, so a malformed row can never make this unlink something
 * outside the attachments folder. A file error never fails the request: the
 * rows are already gone and the DB is the source of truth.
 *
 * @param {number|string} tenantId
 * @param {string} confirm  must equal the workspace's subdomain
 * @param {string} lg
 */
const clearWorkspaceFeedback = async (tenantId, confirm, lg) => {
  try {
    const [[tenant]] = await pool.query(
      "SELECT id, name, subdomain FROM tenants WHERE id = ?",
      [tenantId]
    );
    if (!tenant) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.NOT_FOUND, "workspace_not_found", lg)
      );
    }

    if (String(confirm ?? "").trim() !== tenant.subdomain) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, "clear_confirm_mismatch", lg)
      );
    }

    // Collect the files BEFORE the delete — the rows are gone afterwards.
    const [files] = await pool.query(
      `SELECT pa.storage_path
         FROM post_attachments pa
         JOIN posts p ON p.id = pa.post_id
        WHERE p.tenant_id = ?`,
      [tenantId]
    );

    const [result] = await pool.query("DELETE FROM posts WHERE tenant_id = ?", [
      tenantId,
    ]);

    // Best-effort file cleanup. Never throws — the DB has already committed.
    const root = path.resolve(attachmentDir);
    let filesRemoved = 0;
    for (const row of files) {
      try {
        const target = path.resolve(path.join(root, path.basename(row.storage_path)));
        if (!target.startsWith(root + path.sep)) continue; // cannot escape the folder
        fs.unlinkSync(target);
        filesRemoved += 1;
      } catch {
        /* already gone, or not writable — the row is deleted either way */
      }
    }

    console.log(
      `admin cleared feedback: tenant ${tenant.id} (${tenant.subdomain}) — ` +
        `${result.affectedRows} post(s), ${filesRemoved}/${files.length} attachment file(s) removed`
    );

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "feedback_cleared", lg, {
        deleted: result.affectedRows,
        filesRemoved,
      })
    );
  } catch (error) {
    console.error("admin clearWorkspaceFeedback error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { clearWorkspaceFeedback };
