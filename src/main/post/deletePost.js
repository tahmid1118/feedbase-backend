const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');
const { planAllows } = require('../../common/planGuard');

const deletePost = async (id, authData) => {
  const { tenantId, role, lg } = authData;

  // Deleting feedback is restricted to the workspace owner...
  if (role !== 'owner') {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.FORBIDDEN, 'delete_feedback_owner_only', lg)
    );
  }
  // ...and is a paid capability (Pro plan or higher).
  if (!(await planAllows(tenantId, 'deleteFeedback'))) {
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.PAYMENT_REQUIRED, 'plan_limit_delete_feedback', lg)
    );
  }

  const _query = 'DELETE FROM posts WHERE id = ? AND tenant_id = ?';
  try {
    const [result] = await pool.query(_query, [id, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'post_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'post_deleted_successfully', lg));
  } catch (error) {
    console.error('Error deleting post:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_delete_post', lg));
  }
};
module.exports = { deletePost };
