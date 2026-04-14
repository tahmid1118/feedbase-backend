const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const createComment = async (commentData, authData) => {
  const { postId, body, parentCommentId } = commentData;
  const { id: authorId, tenantId, lg } = authData;
  const _query = 'INSERT INTO comments (tenant_id, post_id, author_id, parent_comment_id, body) VALUES (?, ?, ?, ?, ?)';
  try {
    const [result] = await pool.query(_query, [tenantId, postId, authorId, parentCommentId || null, body]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'comment_created_successfully', lg, { id: result.insertId }));
  } catch (error) {
    console.error('Error creating comment:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_create_comment', lg));
  }
};
module.exports = { createComment };
