const z = require('zod');
const StorageQuotaService = require('../services/storageQuotaService');

/**
 * PATCH /api/v1/admin/storage-quota
 * Single source of truth for the floor is StorageQuotaService.MIN_LIMIT_BYTES
 * (same reasoning as copilotSchemas.js importing CaseService.VALID_STATUSES)
 * so this can't drift from the value the service itself enforces.
 */
const UpdateQuotaInput = z.object({
  storage_limit_bytes: z.number().int().min(
    StorageQuotaService.MIN_LIMIT_BYTES,
    `storage_limit_bytes must be a whole number of at least ${StorageQuotaService.MIN_LIMIT_BYTES} (1GB).`
  )
});

module.exports = { UpdateQuotaInput };
