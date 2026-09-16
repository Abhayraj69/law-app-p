const db = require('../db');

/**
 * Storage Quota Admin Service
 * Backs the ADMIN-only Settings > Storage view — server/middleware/
 * storageQuota.js already enforces the limit on every upload, but until
 * now nothing let an admin see current usage or change the limit itself.
 * Quotas are per-firm (see db/schema.sql's storage_quotas table, keyed
 * on firm_id alone), matching this app's single-firm-per-deployment
 * model — there is no per-user quota to show or adjust.
 */

const MIN_LIMIT_BYTES = 1024 * 1024 * 1024; // 1GB floor, so a fat-fingered value can't lock out every upload firm-wide

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function toView(row) {
  return {
    firm_id: row.firm_id,
    storage_limit_bytes: Number(row.storage_limit_bytes),
    storage_used_bytes: Number(row.storage_used_bytes),
    updated_at: row.updated_at || null
  };
}

class StorageQuotaService {
  static MIN_LIMIT_BYTES = MIN_LIMIT_BYTES;

  /** GET /api/v1/admin/storage-quota */
  static async getQuota(tenantId) {
    const quota = await db.getStorageQuota(tenantId);
    return toView(quota);
  }

  /** PATCH /api/v1/admin/storage-quota — ADMIN raises or lowers the firm's limit. */
  static async updateQuota(tenantId, actingUser, limitBytes) {
    if (!Number.isInteger(limitBytes) || limitBytes < MIN_LIMIT_BYTES) {
      throw badRequest(`storage_limit_bytes must be a whole number of at least ${MIN_LIMIT_BYTES} (1GB).`);
    }

    const row = await db.updateStorageQuotaLimit(tenantId, limitBytes);

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser ? actingUser.id : null,
      action: 'UPDATE_STORAGE_QUOTA',
      details: { storage_limit_bytes: limitBytes }
    });

    return toView(row);
  }
}

module.exports = StorageQuotaService;
