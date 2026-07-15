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
          // Return a clean 'YYYY-MM-DD' string per day (no timezone ambiguity)
          // for the days that HAD posts; the full 30-day series is filled below.
          `SELECT DATE_FORMAT(DATE(created_at), '%Y-%m-%d') AS date, COUNT(*) AS count
           FROM posts
           WHERE tenant_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
           GROUP BY DATE(created_at)`,
          [tenantId]
        )
        .then(([rows]) => rows),
    ]);

    // Expand the sparse per-day counts into a complete 30-day series (today and
    // the previous 29 days), zero-filling empty days, so the client renders a
    // proper daily bar chart instead of a few lonely bars.
    const trendByDate = trend.reduce((acc, row) => {
      acc[row.date] = Number(row.count);
      return acc;
    }, {});
    const trendSeries = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      trendSeries.push({ date: key, count: trendByDate[key] || 0 });
    }

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
      trends: trendSeries,
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
