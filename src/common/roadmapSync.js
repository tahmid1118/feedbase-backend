const { pool } = require("../../database/dbPool");

/**
 * Keeps a post's status and its roadmap position in sync.
 *
 * Roadmap columns are linked to post statuses by `column_key`: a column whose
 * key is a valid post status (e.g. 'planned', 'in_progress', 'completed')
 * represents that status. Moving an item into such a column updates the post's
 * status, and changing a post's status moves its roadmap item into the matching
 * column. Columns with non-status keys (e.g. 'backlog') are left untouched.
 *
 * These helpers swallow their own errors: a sync failure must never break the
 * primary operation that triggered it.
 */

const POST_STATUSES = new Set([
  "open",
  "planned",
  "in_progress",
  "completed",
  "closed",
]);

const statusFromColumnKey = (key) => (POST_STATUSES.has(key) ? key : null);

/** If the target column maps to a status, set the post's status to it. */
const syncPostStatusToColumn = async (tenantId, postId, columnId) => {
  try {
    if (!columnId || !postId) return;
    const [rows] = await pool.query(
      "SELECT column_key FROM roadmap_columns WHERE id = ? AND tenant_id = ?",
      [columnId, tenantId]
    );
    const status = statusFromColumnKey(rows[0] && rows[0].column_key);
    if (status) {
      await pool.query(
        "UPDATE posts SET status = ? WHERE id = ? AND tenant_id = ?",
        [status, postId, tenantId]
      );
    }
  } catch (error) {
    console.error("syncPostStatusToColumn failed:", error.message);
  }
};

/** If a column matches the new status, move the post's roadmap item into it. */
const syncRoadmapItemToStatus = async (tenantId, postId, status) => {
  try {
    if (!POST_STATUSES.has(status)) return;
    const [cols] = await pool.query(
      "SELECT id FROM roadmap_columns WHERE column_key = ? AND tenant_id = ? LIMIT 1",
      [status, tenantId]
    );
    if (cols.length === 0) return;
    await pool.query(
      "UPDATE roadmap_items SET roadmap_column_id = ? WHERE post_id = ? AND tenant_id = ?",
      [cols[0].id, postId, tenantId]
    );
  } catch (error) {
    console.error("syncRoadmapItemToStatus failed:", error.message);
  }
};

module.exports = { syncPostStatusToColumn, syncRoadmapItemToStatus };
