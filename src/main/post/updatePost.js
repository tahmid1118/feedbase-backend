const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const updatePost = async (id, postData, authData) => {
  const { title, description, postType, priority } = postData;
  const { tenantId, lg } = authData;

  const _query = `
    UPDATE posts 
    SET title = ?, description = ?, post_type = ?, priority = ?
    WHERE id = ? AND tenant_id = ?
  `;

  try {
    const [result] = await pool.query(_query, [
      title, description, postType, priority, id, tenantId
    ]);

    if (result.affectedRows === 0) {
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
        'post_updated_successfully',
        lg
      )
    );
  } catch (error) {
    console.error('Error updating post:', error);
    return Promise.reject(
      setServerResponse(
        API_STATUS_CODE.INTERNAL_SERVER_ERROR,
        'failed_to_update_post',
        lg
      )
    );
  }
};

module.exports = { updatePost };
