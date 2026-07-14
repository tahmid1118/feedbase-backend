const { pool } = require('../../../database/dbPool');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const TENANT_ROLES = ['owner', 'user'];

const updateUserRole = async (userId, role, authData) => {
  const { tenantId, lg, role: actorRole } = authData;

  // Only the workspace owner can change roles.
  if (actorRole !== 'owner') {
    return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, 'insufficient_permissions', lg));
  }
  // Only the two tenant roles are assignable ('admin' is a platform role).
  if (!TENANT_ROLES.includes(role)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'invalid_role', lg));
  }

  try {
    // A workspace has exactly ONE owner — everyone else is a member.
    const [owners] = await pool.query(
      "SELECT id FROM users WHERE tenant_id = ? AND role = 'owner'",
      [tenantId]
    );
    const otherOwner = owners.find((o) => String(o.id) !== String(userId));

    if (role === 'owner' && otherOwner) {
      return Promise.reject(
        setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'workspace_already_has_owner', lg)
      );
    }
    // Don't let the sole owner demote themselves and leave the workspace ownerless.
    if (role === 'user' && !otherOwner) {
      const isTargetOwner = owners.some((o) => String(o.id) === String(userId));
      if (isTargetOwner) {
        return Promise.reject(
          setServerResponse(API_STATUS_CODE.BAD_REQUEST, 'workspace_needs_an_owner', lg)
        );
      }
    }

    const _query = 'UPDATE users SET role = ? WHERE id = ? AND tenant_id = ?';
    const [result] = await pool.query(_query, [role, userId, tenantId]);
    if (result.affectedRows === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, 'user_not_found', lg));
    }
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, 'user_role_updated_successfully', lg));
  } catch (error) {
    console.error('Error updating user role:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_update_user_role', lg));
  }
};
module.exports = { updateUserRole };
