const { inMemoryDb } = require('../db');

/**
 * Audit Trail Logging Middleware
 * Automatically records document actions (UPLOAD, VIEW, PREVIEW, DOWNLOAD, SHARE, UPDATE, DELETE, FLAG)
 * for ABA / HIPAA legal compliance tracking.
 */

function logAuditAction(actionType, docIdOverride = null, extraDetails = {}) {
  return (req, res, next) => {
    // Intercept response finish event to ensure action is logged
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const documentId = docIdOverride || req.params.id || req.body.documentId || req.query.documentId || null;
        const folderId = req.body.folderId || req.query.folder_id || null;

        const auditRecord = {
          id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          firm_id: req.tenantId || 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          user_id: req.user ? req.user.id : 'u101ac10b-58cc-4372-a567-0e02b2c3d479',
          user_name: req.user ? req.user.full_name : 'Sarah Jennings',
          document_id: documentId,
          folder_id: folderId,
          action: actionType,
          ip_address: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
          user_agent: req.headers['user-agent'] || 'System API Client',
          details: extraDetails,
          created_at: new Date().toISOString()
        };

        inMemoryDb.audit_logs.unshift(auditRecord);
        console.log(`[AUDIT LOG] Action: ${actionType} | User: ${auditRecord.user_name} | DocID: ${documentId} | IP: ${auditRecord.ip_address}`);
      }
    });

    next();
  };
}

module.exports = logAuditAction;
