const AuditLogService = require('../services/auditLogService');

async function listAuditLogs(req, res, next) {
  try {
    const result = await AuditLogService.listAuditLogs(req.tenantId, req.query);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { listAuditLogs };
