const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * @description Public, read-only feedback board for a tenant. Mirrors the
 * authenticated post list but without any per-user state (no `has_voted`) and
 * without exposing author emails.
 * @param {number} tenantId resolved from the portal subdomain
 * @param {object} paginationData
 * @param {object} filters { status, postType, tagId, search }
 * @param {string} lg
 */
// Public board sort options. vote_count is the SELECT alias below.
const SORTS = {
  newest: "p.created_at DESC",
  oldest: "p.created_at ASC",
  most_voted: "vote_count DESC, p.created_at DESC",
  least_voted: "vote_count ASC, p.created_at DESC",
};

/**
 * Hard caps. This endpoint is UNAUTHENTICATED, so its inputs are fully
 * attacker-controlled and it does not pass through the paginationData
 * middleware. Without a ceiling, `itemsPerPage: 1000000` makes MySQL stream and
 * mysql2 buffer a million rows into memory — one request, one dead process.
 */
const MAX_ITEMS_PER_PAGE = Number(process.env.PUBLIC_MAX_ITEMS_PER_PAGE) || 50;
const MAX_OFFSET = Number(process.env.PUBLIC_MAX_OFFSET) || 100_000;
/** Bound the LIKE term too: a giant string turns every row into a slow scan. */
const MAX_SEARCH_LENGTH = 100;

const getPublicBoard = async (tenantId, paginationData, filters, lg) => {
  const orderBy = SORTS[paginationData?.sortBy] || SORTS.newest;
  const requestedPerPage = Number(paginationData?.itemsPerPage) || 20;
  const itemsPerPage = Math.min(
    Math.max(1, Math.floor(requestedPerPage)),
    MAX_ITEMS_PER_PAGE
  );
  const offset = Math.min(
    Math.max(0, Math.floor(Number(paginationData?.offset) || 0)),
    MAX_OFFSET
  );
  const searchText = (filters?.search || paginationData?.filterBy || "")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);

  let whereClause = " WHERE p.tenant_id = ?";
  const whereParams = [tenantId];

  if (filters?.status) {
    whereClause += " AND p.status = ?";
    whereParams.push(filters.status);
  }
  if (filters?.postType) {
    whereClause += " AND p.post_type = ?";
    whereParams.push(filters.postType);
  }
  if (filters?.tagId) {
    whereClause +=
      " AND p.id IN (SELECT post_id FROM post_tags WHERE tag_id = ? AND tenant_id = ?)";
    whereParams.push(filters.tagId, tenantId);
  }
  if (searchText) {
    whereClause += " AND (p.title LIKE ? OR p.description LIKE ?)";
    const likeText = `%${searchText}%`;
    whereParams.push(likeText, likeText);
  }

  // N+1 AVOIDANCE.
  //
  // This previously ran FOUR correlated subqueries per row (votes, comments,
  // attachment count, thumbnail) — the classic N+1 expressed in SQL. Worse, the
  // most_voted/least_voted sorts order by one of those subqueries, so MySQL had
  // to evaluate them for EVERY matching row before it could apply LIMIT, not
  // just the 20 rows being returned.
  //
  // Now: vote_count comes from a single pre-aggregated derived table joined once
  // (it has to be in this query because the sort depends on it), and the rest
  // are fetched in two batched round-trips over just this page's post ids
  // (below). Total queries are constant — 4 — regardless of page size.
  const _query =
    `SELECT p.id, p.title, p.description, p.post_type, p.status, p.priority,
            p.is_pinned, p.created_at,
            COALESCE(u.full_name, p.submitter_name, 'Anonymous') AS author_name,
            COALESCE(v.vote_count, 0) AS vote_count
     FROM posts p
     LEFT JOIN users u ON p.author_id = u.id
     LEFT JOIN (
       SELECT post_id, COUNT(*) AS vote_count
       FROM votes WHERE tenant_id = ? GROUP BY post_id
     ) v ON v.post_id = p.id` +
    whereClause +
    ` ORDER BY p.is_pinned DESC, ${orderBy} LIMIT ? OFFSET ?`;
  // The derived table's tenant_id binds BEFORE the WHERE clause params.
  const listParams = [tenantId, ...whereParams, itemsPerPage, offset];

  const _countQuery = "SELECT COUNT(*) AS total FROM posts p" + whereClause;

  try {
    // Independent queries — run them together rather than paying two
    // sequential round-trips.
    const [[rows], [countResult]] = await Promise.all([
      pool.query(_query, listParams),
      pool.query(_countQuery, whereParams),
    ]);

    let posts = rows.map((row) => ({
      ...row,
      tags: [],
      comment_count: 0,
      attachment_count: 0,
      thumbnail_path: null,
    }));

    if (posts.length > 0) {
      const postIds = posts.map((p) => p.id);

      // Three batched lookups over this page's ids only, run CONCURRENTLY —
      // they are independent, so awaiting them in sequence would trade one
      // round-trip of latency for nothing.
      const [[tagRows], [commentRows], [attachmentRows]] = await Promise.all([
        pool.query(
          `SELECT pt.post_id, t.id, t.name, t.color_hex
           FROM post_tags pt
           JOIN tags t ON pt.tag_id = t.id
           WHERE pt.tenant_id = ? AND pt.post_id IN (?)`,
          [tenantId, postIds]
        ),
        pool.query(
          `SELECT post_id, COUNT(*) AS comment_count
           FROM comments WHERE tenant_id = ? AND post_id IN (?)
           GROUP BY post_id`,
          [tenantId, postIds]
        ),
        // Attachments are capped at 3 per post, so fetching the rows outright
        // is cheaper than a count + a separate thumbnail lookup, and it lets us
        // derive both in one pass.
        pool.query(
          `SELECT post_id, kind, storage_path
           FROM post_attachments
           WHERE tenant_id = ? AND post_id IN (?)
           ORDER BY id ASC`,
          [tenantId, postIds]
        ),
      ]);

      const tagsByPost = tagRows.reduce((acc, t) => {
        (acc[t.post_id] = acc[t.post_id] || []).push({
          id: t.id,
          name: t.name,
          color_hex: t.color_hex,
        });
        return acc;
      }, {});

      const commentsByPost = commentRows.reduce((acc, c) => {
        acc[c.post_id] = Number(c.comment_count) || 0;
        return acc;
      }, {});

      const attachmentsByPost = attachmentRows.reduce((acc, a) => {
        const entry = (acc[a.post_id] = acc[a.post_id] || {
          count: 0,
          thumbnail: null,
        });
        entry.count += 1;
        // Rows are ordered by id, so the first image encountered is the one the
        // old `ORDER BY id ASC LIMIT 1` subquery would have picked.
        if (entry.thumbnail === null && a.kind === "image") {
          entry.thumbnail = a.storage_path;
        }
        return acc;
      }, {});

      posts = posts.map((p) => ({
        ...p,
        tags: tagsByPost[p.id] || [],
        comment_count: commentsByPost[p.id] || 0,
        attachment_count: attachmentsByPost[p.id]?.count || 0,
        thumbnail_path: attachmentsByPost[p.id]?.thumbnail ?? null,
      }));
    }

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "posts_retrieved_successfully", lg, {
        posts,
        total: countResult[0].total,
      })
    );
  } catch (error) {
    console.error("Error getting public board:", error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        "failed_to_get_posts",
        lg
      )
    );
  }
};

module.exports = { getPublicBoard };
