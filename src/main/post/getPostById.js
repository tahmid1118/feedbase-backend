const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { getAttachmentsForPost } = require("../attachments/attachments");

const getPostById = async (id, authData) => {
  const { id: userId, tenantId, lg } = authData;

  const _query = `
    SELECT p.*,
           COALESCE(u.full_name, p.submitter_name, 'Anonymous') as author_name,
           COALESCE(u.email, p.submitter_email) as author_email,
           (SELECT COUNT(*) FROM votes WHERE post_id = p.id) as vote_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
           EXISTS(SELECT 1 FROM votes WHERE post_id = p.id AND user_id = ?) as has_voted
    FROM posts p
    LEFT JOIN users u ON p.author_id = u.id
    WHERE p.id = ? AND p.tenant_id = ?
  `;

  const _tagQuery = `
    SELECT t.id, t.name, t.color_hex
    FROM post_tags pt
    JOIN tags t ON pt.tag_id = t.id
    WHERE pt.post_id = ? AND pt.tenant_id = ?
  `;

  try {
    const [rows] = await pool.query(_query, [userId, id, tenantId]);

    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(
          API_STATUS_CODE.NOT_FOUND,
          'post_not_found',
          lg
        )
      );
    }

    const [tags] = await pool.query(_tagQuery, [id, tenantId]);
    const attachments = await getAttachmentsForPost(id, tenantId);
    const post = { ...rows[0], has_voted: rows[0].has_voted === 1, tags, attachments };

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        'post_retrieved_successfully',
        lg,
        post
      )
    );
  } catch (error) {
    console.error('Error getting post:', error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        'failed_to_get_post',
        lg
      )
    );
  }
};

module.exports = { getPostById };
