const db = require('../db');

/**
 * Storage Quota Enforcement Middleware
 * Verifies that the tenant has not exceeded their allocated storage limit (e.g. 100GB).
 * Rejects incoming upload requests with 413 Payload Too Large or 402 Payment Required if limit exceeded.
 */

async function enforceStorageQuota(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const quota = await db.getStorageQuota(tenantId);
    quota.storage_limit_bytes = Number(quota.storage_limit_bytes);
    quota.storage_used_bytes = Number(quota.storage_used_bytes);

    // Prefer the actual parsed upload size (set by multer on req.file) over
    // the Content-Length header, which measures the whole multipart body
    // (including form-field overhead and boundaries) rather than the file
    // itself and is trivially spoofable/omittable by a raw client anyway.
    const incomingSize = req.file ? req.file.size : parseInt(req.headers['content-length'] || '0', 10);
    const potentialNewTotal = quota.storage_used_bytes + incomingSize;

    if (quota.storage_used_bytes >= quota.storage_limit_bytes) {
      return res.status(402).json({
        error: 'Payment Required: Storage quota limit reached (100GB limit exceeded). Please upgrade your subscription tier.',
        code: 'QUOTA_EXCEEDED',
        storage_used_bytes: quota.storage_used_bytes,
        storage_limit_bytes: quota.storage_limit_bytes
      });
    }

    if (potentialNewTotal > quota.storage_limit_bytes) {
      return res.status(413).json({
        error: 'Payload Too Large: Incoming file size exceeds remaining available storage quota.',
        code: 'STORAGE_FULL',
        storage_used_bytes: quota.storage_used_bytes,
        storage_limit_bytes: quota.storage_limit_bytes,
        available_bytes: quota.storage_limit_bytes - quota.storage_used_bytes
      });
    }

    // Attach quota info to request
    req.quota = quota;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = enforceStorageQuota;
