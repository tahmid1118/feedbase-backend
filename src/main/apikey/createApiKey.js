const { pool } = require('../../../database/dbPool');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');

const createApiKey = async (apiKeyData, authData) => {
  const { keyName, scopes, expiresAt } = apiKeyData;
  const { id: createdBy, tenantId, lg } = authData;
  
  const rawKey = 'fb_' + crypto.randomBytes(32).toString('hex');
  const keyPrefix = rawKey.substring(0, 10);
  const keyHash = await bcrypt.hash(rawKey, 10);
  
  const _query = 'INSERT INTO api_keys (tenant_id, created_by, key_name, key_prefix, key_hash, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)';
  try {
    const [result] = await pool.query(_query, [tenantId, createdBy, keyName, keyPrefix, keyHash, JSON.stringify(scopes || []), expiresAt || null]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.CREATED, 'api_key_created_successfully', lg, { id: result.insertId, key: rawKey }));
  } catch (error) {
    console.error('Error creating API key:', error);
    return Promise.reject(setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, 'failed_to_create_api_key', lg));
  }
};
module.exports = { createApiKey };
