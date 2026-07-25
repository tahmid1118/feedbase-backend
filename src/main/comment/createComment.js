const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { getTenantPlan } = require('../../common/planGuard');
const { getPlanLimits } = require('../../consts/plans');

const createComment = async (commentData, authData) => {
  const { postId, body, parentCommentId } = commentData;
  const { id: authorId, tenantId, role, lg } = authData;
  // Commenting on your own board as the OWNER is a Pro+ capability (ownerBadge);
  // on Free it's blocked. Display mode: named needs Pro+, hidden needs Business.
  let asOwner = 0;
  if (role === 'owner') {
    const limits = getPlanLimits(await getTenantPlan(tenantId));
    if (!limits.ownerBadge) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.PAYMENT_REQUIRED, 'owner_comment_pro', lg)
      );
    }
    if (commentData.ownerMode === 'hidden' && limits.ownerPrivacy) asOwner = 2;
    else if (commentData.ownerMode === 'named') asOwner = 1;
  }
  const _query = 'INSERT INTO comments (tenant_id, post_id, author_id, as_owner, parent_comment_id, body) VALUES (?, ?, ?, ?, ?, ?)';
  try {
    const [result] = await pool.query(_query, [tenantId, postId, authorId, asOwner, parentCommentId || null, body]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'comment_created_successfully', lg, { id: result.insertId }));
  } catch (error) {
    console.error('Error creating comment:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_create_comment', lg));
  }
};
module.exports = { createComment };
