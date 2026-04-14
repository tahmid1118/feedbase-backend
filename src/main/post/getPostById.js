const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const getPostById = async (id, authData) => {
  const { tenantId, lg } = authData;

  const _query = `
    SELECT p.*, u.full_name as author_name, u.email as author_email,
           (SELECT COUNT(*) FROM votes WHERE post_id = p.id) as vote_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    LEFT JOIN users u ON p.author_id = u.id
    WHERE p.id = ? AND p.tenant_id = ?
  `;

  try {
    const [rows] = await pool.query(_query, [id, tenantId]);
    
    if (rows.length === 0) {
      return Promise.reject(
        setServerResponse(
          API_STATUS_CODE.NOT_FOUND,
          'post_not_found',
          lg
        )
      );
    }

    return Promise.resolve(
      setServerResponse(
        API_STATUS_CODE.OK,
        'post_retrieved_successfully',
        lg,
        rows[0]
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
