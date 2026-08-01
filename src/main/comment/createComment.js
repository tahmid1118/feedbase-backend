const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { getTenantPlan } = require('../../common/planGuard');
const { getPlanLimits } = require('../../consts/plans');

const createComment = async (commentData, authData) => {
  const { postId, body, parentCommentId } = commentData;
  const { id: authorId, tenantId, role, lg } = authData;
  // Commenting is free on every plan. What a paid plan buys is the IDENTITY the
  // comment carries: named "Name (Owner)" needs Pro+ (ownerBadge), name-withheld
  // "Owner" needs Business (ownerPrivacy). An unentitled mode falls back to the
  // plain name rather than rejecting the comment.
  let asOwner = 0;
  if (role === 'owner' && (commentData.ownerMode === 'named' || commentData.ownerMode === 'hidden')) {
    const limits = getPlanLimits(await getTenantPlan(tenantId));
    if (commentData.ownerMode === 'hidden' && limits.ownerPrivacy) asOwner = 2;
    else if (limits.ownerBadge) asOwner = 1;
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
