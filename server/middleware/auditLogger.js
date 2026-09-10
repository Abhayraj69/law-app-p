const db = require('../db');

/**
 * Audit Trail Logging Middleware
 * Automatically records document actions (UPLOAD, VIEW, PREVIEW, DOWNLOAD, SHARE, UPDATE, DELETE, FLAG)
 * for ABA / HIPAA legal compliance tracking. Persisted to the audit_logs table
 * so the trail survives a server restart, same as everything else.
 */

function logAuditAction(actionType, docIdOverride = null, extraDetails = {}) {
  return (req, res, next) => {
    // Intercept response finish event to ensure action is logged
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const documentId = docIdOverride || req.params.id || req.body.documentId || req.query.documentId || null;
        const folderId = req.body.folderId || req.query.folder_id || null;

        db.insertAuditLog({
          firmId: req.tenantId,
          userId: req.user ? req.user.id : null,
          documentId,
          folderId,
          action: actionType,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
          userAgent: req.headers['user-agent'] || 'System API Client',
          details: extraDetails
        }).then(() => {
          console.log(`[AUDIT LOG] Action: ${actionType} | User: ${req.user ? req.user.full_name : 'unknown'} | DocID: ${documentId}`);
        }).catch((err) => {
          // Audit logging must never crash the request it's attached to —
          // the response has already been sent by the time this runs.
          console.error('[AUDIT LOG] Failed to persist audit record:', err.message);
        });
      }
    });

    next();
  };
}

module.exports = logAuditAction;
