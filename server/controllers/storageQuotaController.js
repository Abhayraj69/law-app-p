const StorageQuotaService = require('../services/storageQuotaService');

async function getQuota(req, res, next) {
  try {
    const data = await StorageQuotaService.getQuota(req.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function updateQuota(req, res, next) {
  try {
    const { storage_limit_bytes } = req.body || {};
    const data = await StorageQuotaService.updateQuota(req.tenantId, req.user, storage_limit_bytes);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { getQuota, updateQuota };
