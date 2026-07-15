const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { attachToPost } = require("../attachments/attachments");

const createPost = async (postData, authData) => {
  const { title, description, postType, status, priority, attachmentIds } = postData;
  const { id: authorId, tenantId, lg } = authData;

  const _query = `
    INSERT INTO posts (tenant_id, author_id, title, description, post_type, status, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    const [result] = await pool.query(_query, [
      tenantId, authorId, title, description,
      postType || 'feedback', status || 'open', priority || 3
    ]);

    // Link any attachments uploaded for this post (best-effort; scoped to tenant).
    await attachToPost(pool, attachmentIds, result.insertId, tenantId);

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.CREATED,
        'post_created_successfully',
        lg,
        { id: result.insertId }
      )
    );
  } catch (error) {
    console.error('Error creating post:', error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        'failed_to_create_post',
        lg
      )
    );
  }
};

module.exports = { createPost };
