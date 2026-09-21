const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Consultation intake + document bundling tests (Phase 2).
 *
 * Covers:
 *   - creation, the non-blocking early conflict-check flag, and
 *     matter_category validation against the shared taxonomy;
 *   - a draft is editable, a submitted/approved one is not;
 *   - submit requires intake_notes; approve/decline only apply to
 *     pending_approval; decline returns a consultation to draft (not a
 *     dead end) with a reason recorded;
 *   - document upload + bundling (real pdf-lib PDFs merged via
 *     server/services/pdfTools.js), including a non-PDF being skipped
 *     rather than breaking the bundle;
 *   - convert creates a real case via CaseService.createCase (so the
 *     SAME blocking conflict-check gate applies) and re-points every
 *     linked document (bundle included) at the new case.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Consultation intake and document bundling', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { PDFDocument } = require('pdf-lib');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const ConsultationService = require('../services/consultationService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const PARALEGAL_ID = crypto.randomUUID();
  const PARTNER_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Consultations Test Firm', `consult-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const paralegal = await db.createUser({
    id: PARALEGAL_ID, firmId: FIRM_ID, email: `paralegal-${PARALEGAL_ID}@example.com`,
    fullName: 'Test Paralegal', role: 'PARALEGAL', initials: 'TP', passwordHash
  });
  const partner = await db.createUser({
    id: PARTNER_ID, firmId: FIRM_ID, email: `partner-${PARTNER_ID}@example.com`,
    fullName: 'Test Partner', role: 'PARTNER', initials: 'PT', passwordHash
  });

  async function makePdfBuffer(label) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawText(label, { x: 10, y: 100 });
    return Buffer.from(await doc.save());
  }

  function fileFrom(name, buffer, mimetype = 'application/pdf') {
    return { originalname: name, mimetype, size: buffer.length, buffer };
  }

  // ───────────────────────────────────────────────────────────
  // Creation and validation
  // ───────────────────────────────────────────────────────────

  let consultation;
  await t.test('client_name is required', async () => {
    await assert.rejects(() => ConsultationService.createConsultation(FIRM_ID, paralegal, {}), (err) => err.status === 400);
  });

  await t.test('matter_category must be one of the shared taxonomy', async () => {
    await assert.rejects(
      () => ConsultationService.createConsultation(FIRM_ID, paralegal, { client_name: 'X', matter_category: 'Not A Real Category' }),
      (err) => err.status === 400
    );
  });

  await t.test('a consultation is created as a draft with no conflict flagged', async () => {
    consultation = await ConsultationService.createConsultation(FIRM_ID, paralegal, {
      client_name: 'Priya Sharma', matter_category: 'Family Law', client_contact: '+91-9000000000'
    });
    assert.equal(consultation.status, 'draft');
    assert.equal(consultation.conflict_flag, false);
  });

  await t.test('an early, non-blocking conflict check flags a name reused from an existing case', async () => {
    const existingCase = await db.insertCase({
      id: `CT-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Existing Matter', clientName: 'Rohan Mehta'
    });
    const flagged = await ConsultationService.createConsultation(FIRM_ID, paralegal, {
      client_name: 'Some New Client', opposing_party: 'Rohan Mehta'
    });
    assert.equal(flagged.conflict_flag, true, 'reusing an existing case party name must flag, not block, creation');
    assert.ok(flagged.conflict_details.matches.length > 0);
  });

  // ───────────────────────────────────────────────────────────
  // Editing / state gating
  // ───────────────────────────────────────────────────────────

  await t.test('a draft consultation can be edited', async () => {
    const updated = await ConsultationService.updateConsultation(FIRM_ID, paralegal, consultation.id, {
      intake_notes: 'Initial screening notes.'
    });
    assert.equal(updated.intake_notes, 'Initial screening notes.');
  });

  await t.test('submitting without intake notes is refused', async () => {
    const noNotes = await ConsultationService.createConsultation(FIRM_ID, paralegal, { client_name: 'No Notes Client' });
    await assert.rejects(
      () => ConsultationService.submitConsultation(FIRM_ID, paralegal, noNotes.id),
      (err) => err.status === 400 && err.code === 'NO_INTAKE_NOTES'
    );
  });

  // ───────────────────────────────────────────────────────────
  // Document upload + bundling
  // ───────────────────────────────────────────────────────────

  await t.test('a PDF document can be uploaded and linked to the consultation', async () => {
    const pdf1 = await makePdfBuffer('Document One');
    const doc = await ConsultationService.addDocument(FIRM_ID, paralegal, consultation.id, fileFrom('doc1.pdf', pdf1));
    assert.ok(doc.id);

    const full = await ConsultationService.getConsultation(FIRM_ID, consultation.id);
    assert.equal(full.documents.length, 1);
  });

  await t.test('bundling with only one PDF still produces a bundle document', async () => {
    const result = await ConsultationService.bundleDocuments(FIRM_ID, paralegal, consultation.id);
    assert.ok(result.bundle_document.id);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.consultation.bundle_document_id, result.bundle_document.id);
  });

  await t.test('a non-PDF document is skipped by bundling, not fatal to it', async () => {
    const pdf2 = await makePdfBuffer('Document Two');
    await ConsultationService.addDocument(FIRM_ID, paralegal, consultation.id, fileFrom('doc2.pdf', pdf2));
    await ConsultationService.addDocument(FIRM_ID, paralegal, consultation.id, fileFrom('notes.txt', Buffer.from('plain text notes'), 'text/plain'));

    const result = await ConsultationService.bundleDocuments(FIRM_ID, paralegal, consultation.id);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0], 'notes.txt');

    const { getPageCount } = require('../services/pdfTools');
    const fs = require('fs/promises');
    const { resolveStoragePath } = require('../services/fileService');
    const bytes = await fs.readFile(resolveStoragePath(result.bundle_document.storage_path_url));
    assert.equal(await getPageCount(bytes), 2, 'the regenerated bundle must contain both PDFs, not the skipped text file');
  });

  await t.test('documents cannot be added once the consultation has left draft', async () => {
    await ConsultationService.updateConsultation(FIRM_ID, paralegal, consultation.id, { intake_notes: 'Ready for review.' });
    await ConsultationService.submitConsultation(FIRM_ID, paralegal, consultation.id);

    const pdf3 = await makePdfBuffer('Too Late');
    await assert.rejects(
      () => ConsultationService.addDocument(FIRM_ID, paralegal, consultation.id, fileFrom('late.pdf', pdf3)),
      (err) => err.status === 400 && err.code === 'NOT_DRAFT'
    );
  });

  // ───────────────────────────────────────────────────────────
  // Approval workflow
  // ───────────────────────────────────────────────────────────

  await t.test('editing is refused once submitted (not a draft any more)', async () => {
    await assert.rejects(
      () => ConsultationService.updateConsultation(FIRM_ID, paralegal, consultation.id, { intake_notes: 'x' }),
      (err) => err.status === 400 && err.code === 'NOT_DRAFT'
    );
  });

  await t.test('approve only applies to a pending_approval consultation', async () => {
    const draft = await ConsultationService.createConsultation(FIRM_ID, paralegal, { client_name: 'Still Draft Client' });
    await assert.rejects(
      () => ConsultationService.approveConsultation(FIRM_ID, partner, draft.id),
      (err) => err.status === 409 && err.code === 'WRONG_STATE'
    );
  });

  await t.test('decline requires a reason and returns the consultation to draft', async () => {
    await assert.rejects(
      () => ConsultationService.declineConsultation(FIRM_ID, partner, consultation.id, ''),
      (err) => err.status === 400
    );

    const declined = await ConsultationService.declineConsultation(FIRM_ID, partner, consultation.id, 'Needs more detail on the matter.');
    assert.equal(declined.status, 'draft', 'a decline must return the consultation to draft, not a dead end');
    assert.equal(declined.last_decline_reason, 'Needs more detail on the matter.');
  });

  await t.test('a declined-then-revised consultation can be resubmitted and approved', async () => {
    await ConsultationService.updateConsultation(FIRM_ID, paralegal, consultation.id, { intake_notes: 'Revised notes with more detail.' });
    await ConsultationService.submitConsultation(FIRM_ID, paralegal, consultation.id);
    const approved = await ConsultationService.approveConsultation(FIRM_ID, partner, consultation.id);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.approved_by_user_id, PARTNER_ID);
  });

  // ───────────────────────────────────────────────────────────
  // Conversion
  // ───────────────────────────────────────────────────────────

  await t.test('convert only applies to an approved consultation', async () => {
    const draft = await ConsultationService.createConsultation(FIRM_ID, paralegal, { client_name: 'Not Approved Client' });
    await assert.rejects(
      () => ConsultationService.convertConsultation(FIRM_ID, partner, draft.id),
      (err) => err.status === 409 && err.code === 'WRONG_STATE'
    );
  });

  await t.test('converting an approved consultation creates a real case and re-points its documents', async () => {
    const result = await ConsultationService.convertConsultation(FIRM_ID, partner, consultation.id, {});
    assert.equal(result.consultation.status, 'converted');
    assert.equal(result.consultation.converted_case_id, result.case.id);
    assert.ok(result.case.id.startsWith('LC-'));
    assert.equal(result.case.client, 'Priya Sharma');

    const { rows } = await pool.query(
      `SELECT documents.case_id FROM consultation_documents cd
         JOIN documents ON documents.id = cd.document_id
        WHERE cd.consultation_id = $1`,
      [consultation.id]
    );
    assert.ok(rows.length > 0);
    assert.ok(rows.every(r => r.case_id === result.case.id), 'every linked document (bundle included) must be re-pointed at the new case');
  });

  await t.test('a converted consultation cannot be converted again', async () => {
    await assert.rejects(
      () => ConsultationService.convertConsultation(FIRM_ID, partner, consultation.id, {}),
      (err) => err.status === 409 && err.code === 'WRONG_STATE'
    );
  });

  await t.test('a converted consultation refuses further bundling', async () => {
    await assert.rejects(
      () => ConsultationService.bundleDocuments(FIRM_ID, paralegal, consultation.id),
      (err) => err.status === 400 && err.code === 'ALREADY_CONVERTED'
    );
  });

  // ───────────────────────────────────────────────────────────
  // Audit trail
  // ───────────────────────────────────────────────────────────

  await t.test('consultation actions are all written to the audit log', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT action::text AS action FROM audit_logs WHERE firm_id = $1 AND action::text LIKE '%CONSULTATION%'`,
      [FIRM_ID]
    );
    const actions = new Set(rows.map(r => r.action));
    assert.ok(actions.has('CREATE_CONSULTATION'));
    assert.ok(actions.has('UPLOAD_CONSULTATION_DOCUMENT'));
    assert.ok(actions.has('BUNDLE_CONSULTATION_DOCUMENTS'));
    assert.ok(actions.has('SUBMIT_CONSULTATION'));
    assert.ok(actions.has('APPROVE_CONSULTATION'));
    assert.ok(actions.has('DECLINE_CONSULTATION'));
    assert.ok(actions.has('CONVERT_CONSULTATION'));
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
