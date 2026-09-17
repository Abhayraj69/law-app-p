const express = require('express');
const multer = require('multer');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const enforceStorageQuota = require('../middleware/storageQuota');
const { validateAndScanUpload } = require('../middleware/securityScanner');
const logAuditAction = require('../middleware/auditLogger');
const { validateBody } = require('../middleware/validate');
const { UpdateQuotaInput } = require('../schemas/storageQuotaSchemas');

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
const auditLogController = require('../controllers/auditLogController');
const storageQuotaController = require('../controllers/storageQuotaController');
const searchController = require('../controllers/searchController');
const trustController = require('../controllers/trustController');
const matterIntakeController = require('../controllers/matterIntakeController');
const signatureController = require('../controllers/signatureController');
const timeEntryController = require('../controllers/timeEntryController');

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
router.get('/vault/tags', vaultController.getTags);

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

// C2. DOCUMENT VERSION HISTORY
// The real re-upload path — until now a fresh upload always created a
// whole new document row, and PATCH /files/:id only ever touched
// metadata. Re-upload here creates a new document_versions row and
// repoints the document at it (never overwrites); GET /files/:id/download
// above needs no changes to keep serving the current version, since
// documents.storage_path_url always mirrors the latest version. Same
// middleware chain and no additional requireRole beyond auth, matching
// POST /vault/upload's own posture.
router.get(
  '/files/:id/versions',
  vaultController.getVersions
);
router.get(
  '/files/:id/versions/:versionId/download',
  logAuditAction('DOWNLOAD'),
  vaultController.downloadVersion
);
// :v1/:v2 are version_numbers (the "v1"/"v3" labels already shown in the
// Version History table), not a document_versions.id — the numeric
// constraint keeps this route from ever matching against the UUID-based
// /versions/:versionId/download route above.
router.get(
  '/files/:id/versions/:v1(\\d+)/diff/:v2(\\d+)',
  vaultController.compareVersions
);
router.post(
  '/files/:id/versions',
  upload.single('file'),
  enforceStorageQuota,
  validateAndScanUpload,
  logAuditAction('UPLOAD_VERSION'),
  vaultController.uploadVersion
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
// F2. MATTER INTAKE (conflict check -> engagement letter -> signed ->
// retainer received -> activated)
// A separate, opt-in path from the quick "New Case" flow above — see
// server/services/matterIntakeService.js's header comment. Steps that
// only re-confirm/record something already gated elsewhere (uploading a
// document, marking a letter sent) sit at the same ASSOCIATE+ floor as
// archiving a case; steps that override a compliance control (a conflict
// hit, waiving a retainer) or actually activate the matter are PARTNER+,
// matching the floor TrustService's own writes and invoice mark-paid use.
// ═════════════════════════════════════════════════════════════════════
router.post('/cases/intake', requireRole('ASSOCIATE'), matterIntakeController.startIntake);
// ASSOCIATE+ only, even to read — conflict-check hit details and retainer
// amounts are internal firm information a CLIENT has no reason to see,
// unlike the case record itself (which a CLIENT can read via GET
// /api/v1/cases/:id, ownership-scoped).
router.get('/cases/:id/intake', requireRole('ASSOCIATE'), matterIntakeController.getIntake);
router.post('/cases/:id/intake/conflict-override', requireRole('PARTNER'), matterIntakeController.overrideConflictHold);
router.post(
  '/cases/:id/intake/engagement-letter',
  requireRole('ASSOCIATE'),
  upload.single('file'),
  enforceStorageQuota,
  validateAndScanUpload,
  matterIntakeController.attachEngagementLetter
);
router.post('/cases/:id/intake/engagement-letter/sent', requireRole('ASSOCIATE'), matterIntakeController.markEngagementLetterSent);
router.post(
  '/cases/:id/intake/signed',
  requireRole('ASSOCIATE'),
  upload.single('file'),
  enforceStorageQuota,
  validateAndScanUpload,
  matterIntakeController.attachSignedDocument
);
router.post('/cases/:id/intake/retainer', requireRole('PARTNER'), matterIntakeController.linkRetainer);
router.post('/cases/:id/intake/retainer/waive', requireRole('PARTNER'), matterIntakeController.waiveRetainer);
router.post('/cases/:id/intake/activate', requireRole('PARTNER'), matterIntakeController.activate);
router.post('/cases/:id/intake/decline', requireRole('ASSOCIATE'), matterIntakeController.decline);

// ═════════════════════════════════════════════════════════════════════
// G. CLIENT COMMUNICATIONS
// ═════════════════════════════════════════════════════════════════════
router.get('/conversations', communicationsController.listConversations);
router.get('/conversations/:id', communicationsController.getConversation);
router.post('/conversations/:id/messages', communicationsController.postMessage);

// ═════════════════════════════════════════════════════════════════════
// G1B. E-SIGNATURE REQUESTS
// Staff-authenticated create/list/void, same ASSOCIATE+ floor as archiving
// a case or creating an invoice. The signer's own two actions (view a
// pending request, complete it) are public/token-based — see
// server/routes/auth.js's /sign/:token routes, mounted outside
// authMiddleware the same way /auth/invite/:token is.
// ═════════════════════════════════════════════════════════════════════
router.post('/signatures', requireRole('ASSOCIATE'), signatureController.requestSignature);
router.get('/signatures', requireRole('ASSOCIATE'), signatureController.listSignatures);
router.post('/signatures/:id/void', requireRole('ASSOCIATE'), signatureController.voidSignature);
router.get('/cases/:id/signatures', requireRole('ASSOCIATE'), signatureController.listSignaturesForCase);

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
router.get('/invoices/:id/line-items', timeEntryController.getInvoiceLineItems);
// Rolls a set of unbilled time entries up into a new invoice, atomically
// (see db.insertInvoiceFromTimeEntries). Same ASSOCIATE+ floor as creating
// an invoice directly above — this IS creating an invoice, just from time
// entries instead of a typed amount.
router.post('/invoices/from-time-entries', requireRole('ASSOCIATE'), timeEntryController.generateInvoiceFromTimeEntries);

// ═════════════════════════════════════════════════════════════════════
// G2b. TIME TRACKING
// requireRole('PARALEGAL') — the lowest staff role, one level above
// CLIENT — because logging YOUR OWN billable time is a normal task for
// every staff role, not a privileged action. The privilege distinction
// (own entries only vs. the whole firm's; who may edit/delete once
// entered) is enforced inside TimeEntryService, not by the route floor —
// see that file's header comment for the exact rules.
// ═════════════════════════════════════════════════════════════════════
router.get('/time-entries', requireRole('PARALEGAL'), timeEntryController.listTimeEntries);
router.post('/time-entries', requireRole('PARALEGAL'), timeEntryController.createTimeEntry);
router.patch('/time-entries/:id', requireRole('PARALEGAL'), timeEntryController.updateTimeEntry);
router.delete('/time-entries/:id', requireRole('PARALEGAL'), timeEntryController.deleteTimeEntry);

// ═════════════════════════════════════════════════════════════════════
// G3. TRUST ACCOUNTING
// Client trust funds (retainers) held on a client's behalf, segregated
// from invoices/operating revenue — see server/services/trustService.js
// for why. Every route here, reads included, is gated to PARTNER+: unlike
// billing (ASSOCIATE+ can create/edit invoices), trust ledgers are
// restricted to the roles who bear bar-discipline responsibility for
// them, not opened to every staff role by default. TrustService itself
// does its own audit logging (TRUST_DEPOSIT/DISBURSEMENT/etc.), so no
// logAuditAction middleware is layered on here.
// ═════════════════════════════════════════════════════════════════════
router.get('/trust/accounts', requireRole('PARTNER'), trustController.listAccounts);
router.post('/trust/accounts', requireRole('PARTNER'), trustController.createAccount);
router.get('/trust/client-ledgers', requireRole('PARTNER'), trustController.listClientLedgers);
router.post('/trust/client-ledgers', requireRole('PARTNER'), trustController.createClientLedger);
router.get('/trust/client-ledgers/:id/transactions', requireRole('PARTNER'), trustController.listTransactions);
router.post('/trust/deposits', requireRole('PARTNER'), trustController.recordDeposit);
router.post('/trust/disbursements', requireRole('PARTNER'), trustController.recordDisbursement);
router.post('/trust/transfers', requireRole('PARTNER'), trustController.transferToOperating);
router.post('/trust/transactions/:id/reverse', requireRole('PARTNER'), trustController.reverseTransaction);
router.get('/trust/reconciliation', requireRole('PARTNER'), trustController.getReconciliation);
router.post('/trust/reconciliation', requireRole('PARTNER'), trustController.saveReconciliation);
router.get('/trust/reconciliation/history', requireRole('PARTNER'), trustController.listReconciliationHistory);

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

// Force-logout: ends every session the target user currently has (see
// db/migrations/0020_session_revocation.sql). The departing-employee
// case — without it, a revoked-in-spirit account stays usable for up to
// the full 12-hour token TTL. Audited inside the service rather than via
// logAuditAction, same as the other user-management writes here, because
// that middleware's document_id column doesn't apply to a user target.
router.post('/admin/users/:id/revoke-sessions', requireRole('ADMIN'), inviteController.revokeUserSessions);

// ═════════════════════════════════════════════════════════════════════
// H2. ADMIN — AUDIT LOG VIEWER
// Read-only: audit_logs rows are written throughout the app already
// (logAuditAction middleware for document actions, direct db.insertAuditLog
// calls for case/invoice/invite writes) — this is just the first surface
// that reads any of it back out. Paginated + filterable by user/action/date.
// ═════════════════════════════════════════════════════════════════════
router.get('/admin/audit-logs', requireRole('ADMIN'), auditLogController.listAuditLogs);

// ═════════════════════════════════════════════════════════════════════
// H3. ADMIN — STORAGE QUOTA
// Quota is per-firm (storage_quotas is keyed on firm_id alone, matching
// this app's single-firm-per-deployment model), not per-user. GET is
// read-only usage vs. limit; PATCH is the only way to change the limit
// server/middleware/storageQuota.js enforces on every upload.
// ═════════════════════════════════════════════════════════════════════
router.get('/admin/storage-quota', requireRole('ADMIN'), storageQuotaController.getQuota);
router.patch('/admin/storage-quota', requireRole('ADMIN'), validateBody(UpdateQuotaInput), storageQuotaController.updateQuota);

// ═════════════════════════════════════════════════════════════════════
// I. AI COPILOT TOOLS
// No requireRole() here on purpose: manageFiles and createOrUpdateCase
// each share one route across several actions/fields with different
// privilege floors (manageFiles' delete vs. move/rename/tag;
// createOrUpdateCase's lead_attorney/closing-status vs. everything else),
// so a single route-level requireRole() would either block actions that
// should stay open to any authenticated staff role, or (worse) leave a
// privileged action unguarded. The equivalent checks live inside
// copilotController.js itself, per action/field, and are enforced
// regardless of the HITL `approved` flag — see the SECURITY NOTE at the
// top of that file.
// ═════════════════════════════════════════════════════════════════════
router.post('/copilot/search', copilotController.validateToolInput('searchVault'), copilotController.searchVault);
router.post('/copilot/summarize', copilotController.validateToolInput('summarizeDocument'), copilotController.summarizeDocument);
router.post('/copilot/manage-files', copilotController.validateToolInput('manageFiles'), copilotController.manageFiles);
router.post('/copilot/cases', copilotController.validateToolInput('createOrUpdateCase'), copilotController.createOrUpdateCase);

// The conversational Copilot. No requireRole for the same reason as the
// tools above — and, more to the point, because every tool this endpoint
// can reach is READ-ONLY and individually role-scoped inside
// server/services/copilotTools.js. A mutating request comes back as a
// proposal the user must approve, which then goes through the two
// already-gated routes above. See server/services/copilotAgent.js.
router.post('/copilot/chat', copilotController.chat);

// ═════════════════════════════════════════════════════════════════════
// J. GLOBAL SEARCH (OMNIBOX)
// Read-only, open to any authenticated staff role (no requireRole) —
// same floor GET /api/v1/cases and GET /api/v1/invoices already use.
// Role/ownership scoping is enforced inside SearchService itself, by
// reusing the same role-scoped reads the Active Cases and Document
// Vault pages use, not by gating the route — see
// server/services/searchService.js.
// ═════════════════════════════════════════════════════════════════════
router.get('/search', searchController.search);

module.exports = router;
