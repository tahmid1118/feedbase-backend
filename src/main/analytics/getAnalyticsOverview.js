const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

/**
 * @description Aggregate dashboard analytics for the current tenant.
 * Returns totals, status/type breakdowns, vote/comment sums and a daily posts trend.
 */
const getAnalyticsOverview = async (authData) => {
  const { tenantId, lg } = authData;

  try {
    const [
      [totals],
      statusCounts,
      typeCounts,
      trend,
    ] = await Promise.all([
      pool
        .query(
          `SELECT
              (SELECT COUNT(*) FROM posts WHERE tenant_id = ?) AS total_posts,
              (SELECT COUNT(*) FROM posts WHERE tenant_id = ? AND is_pinned = 1) AS pinned_posts,
              (SELECT COUNT(*) FROM votes WHERE tenant_id = ?) AS total_votes,
              (SELECT COUNT(*) FROM comments WHERE tenant_id = ?) AS total_comments,
              (SELECT COUNT(*) FROM users WHERE tenant_id = ? AND is_active = 1) AS total_users`,
          [tenantId, tenantId, tenantId, tenantId, tenantId]
        )
        .then(([rows]) => rows),
      pool
        .query(
          `SELECT status, COUNT(*) AS count
           FROM posts WHERE tenant_id = ? GROUP BY status`,
          [tenantId]
        )
        .then(([rows]) => rows),
      pool
        .query(
          `SELECT post_type, COUNT(*) AS count
           FROM posts WHERE tenant_id = ? GROUP BY post_type`,
          [tenantId]
        )
        .then(([rows]) => rows),
      pool
        .query(
          `SELECT DATE(created_at) AS date, COUNT(*) AS count
           FROM posts
           WHERE tenant_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
           GROUP BY DATE(created_at)
           ORDER BY date ASC`,
          [tenantId]
        )
        .then(([rows]) => rows),
    ]);

    // Normalize status/type breakdowns into keyed maps for easy client consumption.
    const statusBreakdown = statusCounts.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});
    const typeBreakdown = typeCounts.reduce((acc, row) => {
      acc[row.post_type] = row.count;
      return acc;
    }, {});

    const result = {
      totals: {
        totalPosts: totals.total_posts,
        pinnedPosts: totals.pinned_posts,
        totalVotes: totals.total_votes,
        totalComments: totals.total_comments,
        totalUsers: totals.total_users,
      },
      statusCounts: statusBreakdown,
      typeCounts: typeBreakdown,
      trends: trend,
    };

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, 'analytics_retrieved_successfully', lg, result)
    );
  } catch (error) {
    console.error('Error getting analytics overview:', error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_get_analytics', lg)
    );
  }
};

module.exports = { getAnalyticsOverview };
