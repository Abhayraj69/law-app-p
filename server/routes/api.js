const express = require('express');
const multer = require('multer');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const enforceStorageQuota = require('../middleware/storageQuota');
const { validateAndScanUpload } = require('../middleware/securityScanner');
const logAuditAction = require('../middleware/auditLogger');

// Uploads are held in memory only long enough to validate + write them to
// disk (see FileService.saveUploadedFile) — never written to a temp file
// unvalidated. 50MB matches the limit advertised in the upload modal UI.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const vaultController = require('../controllers/vaultController');
const copilotController = require('../controllers/copilotController');
const dashboardController = require('../controllers/dashboardController');
const caseController = require('../controllers/caseController');
const communicationsController = require('../controllers/communicationsController');
const inviteController = require('../controllers/inviteController');
const invoiceController = require('../controllers/invoiceController');

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
  upload.single('file'),
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

// The client portal's Preview modal fetches these same bytes (there's no
// separate content-rendering route to fetch from — see FileService's own
// comment on why /preview only ever returns metadata) and passes
// ?intent=preview so that use logs as PREVIEW, not DOWNLOAD; omitting it
// (the plain Download button) keeps the original DOWNLOAD logging.
router.get(
  '/files/:id/download',
  (req, res, next) => logAuditAction(req.query.intent === 'preview' ? 'PREVIEW' : 'DOWNLOAD')(req, res, next),
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

// ═════════════════════════════════════════════════════════════════════
// E. DASHBOARD OVERVIEW
// ═════════════════════════════════════════════════════════════════════
router.get('/dashboard/summary', dashboardController.getSummary);

// ═════════════════════════════════════════════════════════════════════
// F. ACTIVE CASES
// ═════════════════════════════════════════════════════════════════════
router.get('/cases', caseController.listCases);
router.get('/cases/:id', caseController.getCase);
router.get('/cases/:id/documents', caseController.getCaseDocuments);
// Deliberately no logAuditAction('UPLOAD') here (unlike /vault/upload
// below) — that middleware would fall back to req.params.id for the
// document id, which on this route is the case id, not a document UUID.
// CaseService.uploadCaseDocument writes its own audit entry once the
// real document id exists. See its doc comment for the full reasoning.
router.post(
  '/cases/:id/documents',
  upload.single('file'),
  enforceStorageQuota,
  validateAndScanUpload,
  caseController.uploadCaseDocument
);
router.get('/cases/:id/deadlines', caseController.getCaseDeadlines);
router.get('/cases/:id/activity', caseController.getCaseActivity);
// Case audit entries are logged directly by CaseService (not via
// logAuditAction) because that middleware's document_id column expects a
// document UUID, and a case id like "LC-2026-001" isn't one — see
// CaseService for where CREATE_CASE / ARCHIVE_CASE audit rows are written.
router.post('/cases', caseController.createCase);
router.patch('/cases/:id/archive', requireRole('ASSOCIATE'), caseController.archiveCase);

// ═════════════════════════════════════════════════════════════════════
// G. CLIENT COMMUNICATIONS
// ═════════════════════════════════════════════════════════════════════
router.get('/conversations', communicationsController.listConversations);
router.get('/conversations/:id', communicationsController.getConversation);
router.post('/conversations/:id/messages', communicationsController.postMessage);

// ═════════════════════════════════════════════════════════════════════
// G2. INVOICES / BILLING (staff Billing page + client portal read)
// Create/edit are gated to ASSOCIATE+ — the same floor DELETE
// /api/v1/files/:id and PATCH /api/v1/cases/:id/archive already use.
// Mark Paid is gated one level higher, to PARTNER+: it's a financial
// attestation that money was actually received (not a metadata edit),
// so it gets a stricter floor rather than defaulting to ASSOCIATE.
// ═════════════════════════════════════════════════════════════════════
router.get('/invoices', invoiceController.listInvoices);
router.post('/invoices', requireRole('ASSOCIATE'), invoiceController.createInvoice);
router.patch('/invoices/:id', requireRole('ASSOCIATE'), invoiceController.updateInvoice);
router.patch('/invoices/:id/mark-paid', requireRole('PARTNER'), invoiceController.markInvoicePaid);

// ═════════════════════════════════════════════════════════════════════
// H. ADMIN — TEAM / USER PROVISIONING
// Single-firm, admin-invite only: there is no self-signup route anywhere
// in this app, and nothing here accepts a firm_id from the caller — every
// invite is created under req.tenantId (the ADMIN's own firm, resolved
// from their verified token, same as every other route in this file).
// ═════════════════════════════════════════════════════════════════════
router.get('/admin/users', requireRole('ADMIN'), inviteController.listTeam);
router.post(
  '/admin/invites',
  requireRole('ADMIN'),
  logAuditAction('CREATE_USER_INVITE'),
  inviteController.createInvite
);

// I. AI COPILOT TOOLS
router.post('/copilot/search', copilotController.validateToolInput('searchVault'), copilotController.searchVault);
router.post('/copilot/summarize', copilotController.validateToolInput('summarizeDocument'), copilotController.summarizeDocument);
router.post('/copilot/manage-files', copilotController.validateToolInput('manageFiles'), copilotController.manageFiles);
router.post('/copilot/cases', copilotController.validateToolInput('createOrUpdateCase'), copilotController.createOrUpdateCase);

module.exports = router;
