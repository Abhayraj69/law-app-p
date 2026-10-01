const db = require('../db');
const VaultService = require('./vaultService');
const CaseService = require('./caseService');
const ConflictCheckService = require('./conflictCheckService');
const pdfTools = require('./pdfTools');
const { readStoredFile } = require('./fileService');
const { MATTER_CATEGORIES } = require('../constants/matterCategories');

/**
 * Consultation Service
 *
 * Phase 2: staff-assisted intake for a prospective client, BEFORE any case
 * exists — see db/migrations/0023_consultations.sql's header for why this
 * is structurally new rather than an extension of case_intake (which
 * already assumes a `cases` row).
 *
 * Lifecycle: draft -> pending_approval -> approved -> converted, with a
 * decline from pending_approval landing back on draft (not a dead end) —
 * mirrors the Copilot's propose/approve shape (a rejection is something
 * staff can act on and resubmit), adapted to a persisted row instead of an
 * ephemeral chat payload, since a consultation note needs to survive a
 * page reload and be independently listable/auditable.
 *
 * Role floors (enforced by requireRole in server/routes/api.js, mirrored
 * here only where an extra state check is also needed):
 *   - PARALEGAL+ : create, edit (draft only), upload documents, bundle, submit.
 *   - PARTNER+   : approve / decline — "lawyer approval," same floor
 *                  case_intake's own activate/decline already uses for the
 *                  analogous "commit this matter for real" decision.
 *   - ASSOCIATE+ : convert to a real case — same floor case creation
 *                  generally sits behind elsewhere in this app.
 */

function notFound() {
  const err = new Error('Consultation not found.');
  err.status = 404;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function wrongState(consultation, expected) {
  const err = new Error(`This consultation is "${consultation.status}", not "${expected}" — this action isn't available right now.`);
  err.status = 409;
  err.code = 'WRONG_STATE';
  throw err;
}

function toConsultationView(row, documents = []) {
  return {
    id: row.id,
    client_name: row.client_name,
    client_contact: row.client_contact,
    matter_category: row.matter_category,
    opposing_party: row.opposing_party,
    opposing_counsel: row.opposing_counsel,
    referral_source: row.referral_source,
    intake_notes: row.intake_notes,
    status: row.status,
    conflict_flag: row.conflict_flag,
    conflict_details: row.conflict_details,
    bundle_document_id: row.bundle_document_id,
    created_by_user_id: row.created_by_user_id,
    created_by_name: row.created_by_name,
    approved_by_user_id: row.approved_by_user_id,
    approved_by_name: row.approved_by_name,
    approved_at: row.approved_at,
    last_decline_reason: row.last_decline_reason,
    converted_case_id: row.converted_case_id,
    converted_at: row.converted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    documents: documents.map(d => ({
      id: d.id, file_name: d.file_name, original_name: d.original_name,
      extension: d.extension, file_size_bytes: Number(d.file_size_bytes)
    }))
  };
}

function validateMatterCategory(category) {
  if (category !== undefined && category !== null && category !== '' && !MATTER_CATEGORIES.includes(category)) {
    throw badRequest(`matter_category must be one of: ${MATTER_CATEGORIES.join(', ')}.`);
  }
  return category;
}

async function assertConsultation(tenantId, consultationId) {
  const row = await db.getConsultationById(tenantId, consultationId);
  if (!row) throw notFound();
  return row;
}

class ConsultationService {
  static get MATTER_CATEGORIES() {
    return MATTER_CATEGORIES;
  }

  /** GET /api/v1/consultations */
  static async listConsultations(tenantId, filters = {}) {
    const rows = await db.listConsultationsForFirm(tenantId, filters);
    return rows.map(r => toConsultationView(r));
  }

  /** GET /api/v1/consultations/:id */
  static async getConsultation(tenantId, consultationId) {
    const row = await assertConsultation(tenantId, consultationId);
    const documents = await db.listConsultationDocuments(consultationId);
    return toConsultationView(row, documents);
  }

  /**
   * POST /api/v1/consultations — runs an early, NON-blocking conflict
   * check (see the migration's own comment on conflict_flag) so staff see
   * a warning immediately rather than only discovering a conflict at
   * conversion time, after they've already built out the intake.
   */
  static async createConsultation(tenantId, actingUser, payload = {}) {
    const { client_name, client_contact, matter_category, opposing_party, opposing_counsel, referral_source, intake_notes } = payload;

    if (!client_name || !client_name.trim()) {
      throw badRequest('client_name is required.');
    }
    validateMatterCategory(matter_category);

    const { matches } = await ConflictCheckService.checkConflicts(tenantId, {
      client: client_name.trim(),
      opposingParty: opposing_party || null,
      opposingCounsel: opposing_counsel || null,
      relatedEntities: []
    });

    const row = await db.insertConsultation({
      firmId: tenantId,
      clientName: client_name.trim(),
      clientContact: client_contact || null,
      matterCategory: matter_category || null,
      opposingParty: opposing_party || null,
      opposingCounsel: opposing_counsel || null,
      referralSource: referral_source || null,
      intakeNotes: intake_notes || null,
      conflictFlag: matches.length > 0,
      conflictDetails: matches.length ? { matches } : null,
      createdByUserId: actingUser.id
    });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'CREATE_CONSULTATION',
      details: { consultation_id: row.id, client_name: row.client_name, conflict_flag: row.conflict_flag }
    });

    return toConsultationView(row);
  }

  /** PATCH /api/v1/consultations/:id — editable only while still a draft. */
  static async updateConsultation(tenantId, actingUser, consultationId, payload = {}) {
    const existing = await assertConsultation(tenantId, consultationId);
    if (existing.status !== 'draft') {
      throw badRequest('Only a draft consultation can be edited — decline it back to draft first, or it has already moved on.', 'NOT_DRAFT');
    }

    validateMatterCategory(payload.matter_category);

    const updates = {};
    if (payload.client_name !== undefined) {
      if (!payload.client_name.trim()) throw badRequest('client_name cannot be empty.');
      updates.clientName = payload.client_name.trim();
    }
    if (payload.client_contact !== undefined) updates.clientContact = payload.client_contact;
    if (payload.matter_category !== undefined) updates.matterCategory = payload.matter_category;
    if (payload.opposing_party !== undefined) updates.opposingParty = payload.opposing_party;
    if (payload.opposing_counsel !== undefined) updates.opposingCounsel = payload.opposing_counsel;
    if (payload.referral_source !== undefined) updates.referralSource = payload.referral_source;
    if (payload.intake_notes !== undefined) updates.intakeNotes = payload.intake_notes;

    const row = await db.updateConsultationFields(tenantId, consultationId, updates);

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'UPDATE_CONSULTATION',
      details: { consultation_id: consultationId, updates: payload }
    });

    return toConsultationView(row);
  }

  /**
   * POST /api/v1/consultations/:id/documents — a single multer file,
   * stored the same way VaultService.initiateUpload stores any other
   * upload, with case_id left NULL (no case exists yet) and linked via
   * consultation_documents instead.
   */
  static async addDocument(tenantId, actingUser, consultationId, file) {
    const existing = await assertConsultation(tenantId, consultationId);
    if (existing.status !== 'draft') {
      throw badRequest('Documents can only be added while the consultation is still a draft.', 'NOT_DRAFT');
    }

    const { document } = await VaultService.initiateUpload(tenantId, actingUser.id, file, {
      case_id: null, tags: ['Consultation Intake']
    });

    await db.linkConsultationDocument(consultationId, document.id);

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'UPLOAD_CONSULTATION_DOCUMENT',
      details: { consultation_id: consultationId, document_id: document.id, file_name: document.file_name }
    });

    return document;
  }

  /**
   * POST /api/v1/consultations/:id/bundle — merges every PDF document
   * currently linked to this consultation into one PDF via
   * server/services/pdfTools.js (Phase 0), and stores the result as a new
   * document. Regenerates in place: bundle_document_id always names the
   * CURRENT bundle, not a history of them (the old bundle document row is
   * left on disk/in the table, just no longer referenced — same
   * "superseded, not deleted" posture document VERSIONS already have).
   * Non-PDF documents (an image, a .docx) are skipped, reported back by
   * name, not silently dropped nor a hard failure of the whole bundle.
   */
  static async bundleDocuments(tenantId, actingUser, consultationId) {
    const existing = await assertConsultation(tenantId, consultationId);
    if (existing.status === 'converted') {
      throw badRequest('This consultation has already been converted to a case.', 'ALREADY_CONVERTED');
    }

    // Excludes the CURRENT bundle document itself (identified by id, not
    // just its tag — a regeneration must never fold last time's bundle in
    // as one of this time's source PDFs, which would make every
    // subsequent bundle grow to include every prior bundle too).
    const documents = (await db.listConsultationDocuments(consultationId))
      .filter(d => d.id !== existing.bundle_document_id);
    const pdfDocs = documents.filter(d => (d.extension || '').toLowerCase() === 'pdf');
    const skipped = documents.filter(d => (d.extension || '').toLowerCase() !== 'pdf').map(d => d.original_name);

    if (pdfDocs.length === 0) {
      throw badRequest('No PDF documents are attached to bundle — upload at least one PDF first.', 'NO_PDFS');
    }

    const buffers = await Promise.all(pdfDocs.map(async (d) => {
      const buffer = await readStoredFile(d.storage_path_url);
      if (!buffer) {
        throw badRequest(`'${d.original_name}' has no real file content in storage — it may be missing or never actually uploaded.`, 'NO_FILE_CONTENT');
      }
      return buffer;
    }));

    const mergedBuffer = await pdfTools.mergePdfs(buffers);

    const bundleFile = {
      originalname: `${existing.client_name.replace(/[^\w -]/g, '').trim() || 'consultation'} — Bundle.pdf`,
      mimetype: 'application/pdf',
      size: mergedBuffer.length,
      buffer: mergedBuffer
    };
    const { document: bundleDocument } = await VaultService.initiateUpload(tenantId, actingUser.id, bundleFile, {
      case_id: null, tags: ['Consultation Bundle'], allow_duplicate: true
    });

    await db.linkConsultationDocument(consultationId, bundleDocument.id);
    const row = await db.updateConsultationFields(tenantId, consultationId, { bundleDocumentId: bundleDocument.id });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'BUNDLE_CONSULTATION_DOCUMENTS',
      details: { consultation_id: consultationId, bundle_document_id: bundleDocument.id, page_source_count: pdfDocs.length, skipped }
    });

    return { consultation: toConsultationView(row), bundle_document: bundleDocument, skipped };
  }

  /**
   * POST /api/v1/consultations/:id/submit — draft -> pending_approval.
   * Requires a non-empty intake_notes: this endpoint is what "finalizes"
   * the consultation note the roadmap's lawyer-approval screen reviews, so
   * there has to be a note to review.
   */
  static async submitConsultation(tenantId, actingUser, consultationId) {
    const existing = await assertConsultation(tenantId, consultationId);
    if (existing.status !== 'draft') wrongState(existing, 'draft');
    if (!existing.intake_notes || !existing.intake_notes.trim()) {
      throw badRequest('Add intake notes before submitting for approval.', 'NO_INTAKE_NOTES');
    }

    const row = await db.updateConsultationFields(tenantId, consultationId, { status: 'pending_approval' });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'SUBMIT_CONSULTATION',
      details: { consultation_id: consultationId }
    });

    return toConsultationView(row);
  }

  /** PATCH /api/v1/consultations/:id/approve — pending_approval -> approved. */
  static async approveConsultation(tenantId, actingUser, consultationId) {
    const existing = await assertConsultation(tenantId, consultationId);
    if (existing.status !== 'pending_approval') wrongState(existing, 'pending_approval');

    const row = await db.updateConsultationFields(tenantId, consultationId, {
      status: 'approved', approvedByUserId: actingUser.id, approvedAt: new Date()
    });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'APPROVE_CONSULTATION',
      details: { consultation_id: consultationId }
    });

    return toConsultationView(row);
  }

  /**
   * PATCH /api/v1/consultations/:id/decline — pending_approval -> draft,
   * with a reason recorded so staff know what to fix before resubmitting.
   * Not a terminal state — see this file's header comment.
   */
  static async declineConsultation(tenantId, actingUser, consultationId, reason) {
    const existing = await assertConsultation(tenantId, consultationId);
    if (existing.status !== 'pending_approval') wrongState(existing, 'pending_approval');
    if (!reason || !reason.trim()) {
      throw badRequest('A reason is required to decline a consultation note.');
    }

    const row = await db.updateConsultationFields(tenantId, consultationId, {
      status: 'draft', lastDeclineReason: reason.trim()
    });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'DECLINE_CONSULTATION',
      details: { consultation_id: consultationId, reason: reason.trim() }
    });

    return toConsultationView(row);
  }

  /**
   * POST /api/v1/consultations/:id/convert — approved -> converted.
   * Delegates the actual case row to CaseService.createCase rather than
   * re-implementing case creation here, so the SAME conflict-check gate,
   * id-minting, and audit trail that governs every other path into
   * `cases` also governs this one — the early conflict_flag on the
   * consultation is a warning, this call is the real, blocking gate.
   */
  static async convertConsultation(tenantId, actingUser, consultationId, payload = {}) {
    const existing = await assertConsultation(tenantId, consultationId);
    if (existing.status !== 'approved') wrongState(existing, 'approved');

    const title = (payload.title && payload.title.trim())
      || `${existing.matter_category || 'Matter'} — ${existing.client_name}`;

    const newCase = await CaseService.createCase(tenantId, actingUser, {
      title,
      client: existing.client_name,
      opposingParty: existing.opposing_party,
      opposingCounsel: existing.opposing_counsel,
      area: existing.matter_category,
      attorney: payload.attorney,
      description: existing.intake_notes,
      conflictOverride: payload.conflict_override,
      conflictOverrideReason: payload.conflict_override_reason
    }, 'CREATE_CASE');

    await db.reassignConsultationDocumentsToCase(tenantId, consultationId, newCase.id);

    const row = await db.updateConsultationFields(tenantId, consultationId, {
      status: 'converted', convertedCaseId: newCase.id, convertedAt: new Date()
    });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'CONVERT_CONSULTATION',
      details: { consultation_id: consultationId, case_id: newCase.id }
    });

    return { consultation: toConsultationView(row), case: newCase };
  }
}

module.exports = ConsultationService;
