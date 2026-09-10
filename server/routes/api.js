const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const enforceStorageQuota = require('../middleware/storageQuota');
const { validateAndScanUpload } = require('../middleware/securityScanner');
const logAuditAction = require('../middleware/auditLogger');

const vaultController = require('../controllers/vaultController');
const copilotController = require('../controllers/copilotController');

// Apply Global Tenant Authentication & User Context
router.use(authMiddleware);

// ═════════════════════════════════════════════════════════════════════
// A. VAULT OVERVIEW & ANALYTICS
// ═════════════════════════════════════════════════════════════════════
router.get('/vault/stats', vaultController.getStats);

// ═════════════════════════════════════════════════════════════════════
// B. FILE & FOLDER MANAGEMENT
// ═════════════════════════════════════════════════════════════════════
router.get('/vault/tree', vaultController.getTree);
router.get('/vault/files', vaultController.getFiles);

router.post(
  '/vault/folders',
  logAuditAction('CREATE_FOLDER'),
  vaultController.createFolder
);

router.post(
  '/vault/upload',
  enforceStorageQuota,
  validateAndScanUpload,
  logAuditAction('UPLOAD'),
  vaultController.uploadFile
);

// ═════════════════════════════════════════════════════════════════════
// C. FILE OPERATIONS (ROW ACTIONS)
// ═════════════════════════════════════════════════════════════════════
router.get(
  '/files/:id/preview',
  logAuditAction('PREVIEW'),
  vaultController.getPreview
);

router.get(
  '/files/:id/download',
  logAuditAction('DOWNLOAD'),
  vaultController.downloadFile
);

router.post(
  '/files/:id/share',
  logAuditAction('SHARE'),
  vaultController.shareFile
);

router.patch(
  '/files/:id',
  logAuditAction('UPDATE_METADATA'),
  vaultController.patchFile
);

router.delete(
  '/files/:id',
  requireRole('ASSOCIATE'), // Requires Associate or higher to soft-delete
  logAuditAction('DELETE'),
  vaultController.deleteFile
);

// ═════════════════════════════════════════════════════════════════════
// D. WIDGETS & INTEGRATIONS
// ═════════════════════════════════════════════════════════════════════
router.get('/vault/quick-access', vaultController.getQuickAccess);
router.get('/vault/flagged-messages', vaultController.getFlaggedMessages);
router.get('/vault/deadlines', vaultController.getDeadlines);
router.get('/vault/sidebar-widgets', vaultController.getSidebarWidgets);

// E. AI COPILOT TOOLS
router.post('/copilot/search', copilotController.validateToolInput('searchVault'), copilotController.searchVault);
router.post('/copilot/summarize', copilotController.validateToolInput('summarizeDocument'), copilotController.summarizeDocument);
router.post('/copilot/manage-files', copilotController.validateToolInput('manageFiles'), copilotController.manageFiles);
router.post('/copilot/cases', copilotController.validateToolInput('createOrUpdateCase'), copilotController.createOrUpdateCase);

module.exports = router;
