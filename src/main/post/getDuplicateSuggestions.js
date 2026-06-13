const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

// Common words that add noise to title matching.
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'add', 'please',
  'need', 'want', 'when', 'have', 'are', 'not', 'but', 'can', 'how', 'all',
]);

/**
 * @description Suggest possible duplicate posts for a given post by matching
 * significant title keywords within the same tenant. Already-flagged duplicates
 * and the post itself are excluded.
 */
const getDuplicateSuggestions = async (id, authData) => {
  const { tenantId, lg } = authData;

  try {
    const [rows] = await pool.query(
      'SELECT id, title FROM posts WHERE id = ? AND tenant_id = ?',
      [id, tenantId]
    );
    if (rows.length === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'post_not_found', lg));
    }

    const keywords = (rows[0].title || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

    // No meaningful keywords to match on -> empty suggestion set.
    if (keywords.length === 0) {
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, 'duplicate_suggestions_retrieved_successfully', lg, [])
      );
    }

    const likeConditions = keywords.map(() => 'p.title LIKE ?').join(' OR ');
    const params = [tenantId, id, ...keywords.map((w) => `%${w}%`)];

    const _query = `
      SELECT p.id, p.title, p.status, p.post_type, p.created_at,
             (SELECT COUNT(*) FROM votes WHERE post_id = p.id) as vote_count
      FROM posts p
      WHERE p.tenant_id = ?
        AND p.id <> ?
        AND p.duplicate_of_post_id IS NULL
        AND (${likeConditions})
      ORDER BY vote_count DESC, p.created_at DESC
      LIMIT 10
    `;

    const [suggestions] = await pool.query(_query, params);

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, 'duplicate_suggestions_retrieved_successfully', lg, suggestions)
    );
  } catch (error) {
    console.error('Error getting duplicate suggestions:', error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_duplicate_suggestions', lg)
    );
  }
};

module.exports = { getDuplicateSuggestions };
