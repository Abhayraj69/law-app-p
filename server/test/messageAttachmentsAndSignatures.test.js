const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Tests for two features that replace README's former "What's still
 * mock/static" entries:
 *
 * 1. Structured message attachments (db/migrations/0018) —
 *    conversation_messages.attachment_document_id, wired through
 *    CommunicationsService.postMessage/toMessageView.
 * 2. The pluggable e-signature workflow (db/migrations/0019) —
 *    SignatureService, the 'local' provider, and its integration with
 *    MatterIntakeService's SIGNED step.
 *
 * Requires a real database via TEST_DATABASE_URL, same as the other
 * integration suites — skipped (not failed) if it isn't set.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Message attachments and e-signature requests', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const CommunicationsService = require('../services/communicationsService');
  const SignatureService = require('../services/signatureService');
  const MatterIntakeService = require('../services/matterIntakeService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Attachments & Signatures Test Firm', `attach-sig-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const staffUser = await db.createUser({
    id: crypto.randomUUID(), firmId: FIRM_ID, email: `staff-${crypto.randomUUID()}@example.com`,
    fullName: 'Sam Rivera', role: 'ASSOCIATE', initials: 'SR', passwordHash
  });
  const clientUser = await db.createUser({
    id: crypto.randomUUID(), firmId: FIRM_ID, email: `client-${crypto.randomUUID()}@example.com`,
    fullName: 'Test Client', role: 'CLIENT', initials: 'TC', passwordHash
  });
  const clientUserId = clientUser.id;

  async function makeDocument(caseId) {
    const doc = await db.insertDocument({
      id: crypto.randomUUID(), firm_id: FIRM_ID, file_name: 'letter.pdf', original_name: 'Engagement Letter.pdf',
      file_type: 'application/pdf', extension: 'pdf', file_size_bytes: 1024,
      storage_path_url: `/tmp/${crypto.randomUUID()}.pdf`, case_id: caseId || null, author_id: staffUser.id
    });
    return doc;
  }

  async function makeCaseWithClient() {
    const caseId = `ATT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await db.insertCase({ id: caseId, firmId: FIRM_ID, caseName: 'Attachment Test Matter', clientName: 'Test Client' });
    await pool.query(`UPDATE cases SET client_user_id = $1 WHERE id = $2`, [clientUserId, caseId]);
    return caseId;
  }

  await t.test('posting a message with a valid attachmentDocumentId links a real document', async () => {
    const caseId = await makeCaseWithClient();
    const doc = await makeDocument(caseId);
    const conv = await db.insertConversation({ firmId: FIRM_ID, caseId, clientUserId, clientName: 'Test Client' });

    const message = await CommunicationsService.postMessage(FIRM_ID, staffUser, conv.id, {
      text: 'Please see the attached engagement letter.',
      attachmentDocumentId: doc.id
    });

    assert.ok(message.attachment);
    assert.equal(message.attachment.documentId, doc.id);
    assert.equal(message.attachment.name, 'Engagement Letter.pdf');

    // Prove it's really persisted, not just returned in the response.
    const reread = await db.getConversationWithMessages(FIRM_ID, conv.id, staffUser, true);
    const rereadMsg = reread.messages.find(m => m.id === message.id);
    assert.equal(rereadMsg.attachment_document_id, doc.id);
  });

  await t.test('a message with no attachment has attachment: null', async () => {
    const caseId = await makeCaseWithClient();
    const conv = await db.insertConversation({ firmId: FIRM_ID, caseId, clientUserId, clientName: 'Test Client' });

    const message = await CommunicationsService.postMessage(FIRM_ID, staffUser, conv.id, { text: 'No file here.' });
    assert.equal(message.attachment, null);
  });

  await t.test('attaching a document from a DIFFERENT firm is refused, not silently linked', async () => {
    const otherFirmId = crypto.randomUUID();
    await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [otherFirmId, 'Other Firm', `other-${otherFirmId}.example`]);
    const otherDoc = await db.insertDocument({
      id: crypto.randomUUID(), firm_id: otherFirmId, file_name: 'x.pdf', original_name: 'x.pdf',
      file_type: 'application/pdf', extension: 'pdf', file_size_bytes: 10, storage_path_url: '/tmp/x.pdf'
    });

    const caseId = await makeCaseWithClient();
    const conv = await db.insertConversation({ firmId: FIRM_ID, caseId, clientUserId, clientName: 'Test Client' });

    await assert.rejects(
      () => CommunicationsService.postMessage(FIRM_ID, staffUser, conv.id, { text: 'hi', attachmentDocumentId: otherDoc.id }),
      (err) => { assert.equal(err.status, 400); assert.equal(err.code, 'ATTACHMENT_NOT_FOUND'); return true; }
    );
  });

  await t.test('requestSignature creates a request and returns a one-time sign_path', async () => {
    const caseId = await makeCaseWithClient();
    const doc = await makeDocument(caseId);

    const result = await SignatureService.requestSignature(FIRM_ID, staffUser, {
      caseId, documentId: doc.id, signerName: 'Jane Anderson', signerEmail: 'jane@example.com'
    });

    assert.equal(result.status, 'sent');
    assert.equal(result.document_id, doc.id);
    assert.match(result.sign_path, /^\/sign-document\.html\?token=/);
  });

  await t.test('requestSignature rejects an unknown document', async () => {
    await assert.rejects(
      () => SignatureService.requestSignature(FIRM_ID, staffUser, {
        documentId: crypto.randomUUID(), signerName: 'Jane', signerEmail: 'jane@example.com'
      }),
      (err) => { assert.equal(err.code, 'DOCUMENT_NOT_FOUND'); return true; }
    );
  });

  await t.test('the public signing flow: view, sign, and re-signing the same link fails', async () => {
    const doc = await makeDocument(null);
    const result = await SignatureService.requestSignature(FIRM_ID, staffUser, {
      documentId: doc.id, signerName: 'Jane Anderson', signerEmail: 'jane@example.com'
    });
    const token = result.sign_path.split('token=')[1];

    const preview = await SignatureService.getPublicSigningView(token);
    assert.equal(preview.signer_name, 'Jane Anderson');
    assert.equal(preview.document_name, 'Engagement Letter.pdf');

    const signed = await SignatureService.completeSigning(token, { typedName: 'Jane Anderson' }, { ip: '127.0.0.1' });
    assert.equal(signed.status, 'signed');
    assert.equal(signed.signed_document_id, doc.id);

    // The link is single-use — a second completion attempt (or even just
    // viewing it again) must behave like an invalid/expired token, not
    // silently re-sign or leak that it once worked.
    await assert.rejects(() => SignatureService.getPublicSigningView(token), /invalid, expired/);
    await assert.rejects(
      () => SignatureService.completeSigning(token, { typedName: 'Jane Anderson' }, {}),
      /invalid, expired/
    );
  });

  await t.test('voidRequest blocks void of an already-signed request, but allows it for a still-pending one', async () => {
    const doc = await makeDocument(null);

    const pending = await SignatureService.requestSignature(FIRM_ID, staffUser, {
      documentId: doc.id, signerName: 'Pending Signer', signerEmail: 'pending@example.com'
    });
    const voided = await SignatureService.voidRequest(FIRM_ID, staffUser, pending.id, 'Sent to the wrong person.');
    assert.equal(voided.status, 'voided');
    assert.equal(voided.voided_reason, 'Sent to the wrong person.');

    const toSign = await SignatureService.requestSignature(FIRM_ID, staffUser, {
      documentId: doc.id, signerName: 'Will Sign', signerEmail: 'willsign@example.com'
    });
    const token = toSign.sign_path.split('token=')[1];
    await SignatureService.completeSigning(token, { typedName: 'Will Sign' }, {});

    await assert.rejects(
      () => SignatureService.voidRequest(FIRM_ID, staffUser, toSign.id, 'too late'),
      (err) => { assert.equal(err.code, 'INVALID_STATE'); return true; }
    );
  });

  await t.test('a completed signature request tied to a case in ENGAGEMENT_LETTER_SENT auto-advances Matter Intake to SIGNED', async () => {
    const caseId = `ATT-INTAKE-${Date.now()}`;
    await db.insertCase({ id: caseId, firmId: FIRM_ID, caseName: 'Intake Signature Matter', clientName: 'Intake Client', status: 'pending' });
    await db.insertCaseIntake({ caseId, firmId: FIRM_ID, state: 'ENGAGEMENT_LETTER_SENT', conflictMatches: [] });
    await db.insertCaseIntakeEvent({ caseId, fromState: 'ENGAGEMENT_LETTER_DRAFTED', toState: 'ENGAGEMENT_LETTER_SENT', actorId: staffUser.id });

    const letter = await makeDocument(caseId);
    const request = await SignatureService.requestSignature(FIRM_ID, staffUser, {
      caseId, documentId: letter.id, signerName: 'Case Client', signerEmail: 'caseclient@example.com'
    });
    const token = request.sign_path.split('token=')[1];

    await SignatureService.completeSigning(token, { typedName: 'Case Client' }, {});

    const intake = await MatterIntakeService.getIntake(FIRM_ID, caseId);
    assert.equal(intake.state, 'SIGNED');
    assert.equal(intake.signed_document_id, letter.id);
  });

  await t.test('a signature request tied to a case NOT waiting on ENGAGEMENT_LETTER_SENT leaves intake untouched', async () => {
    const caseId = `ATT-INTAKE2-${Date.now()}`;
    await db.insertCase({ id: caseId, firmId: FIRM_ID, caseName: 'Untouched Intake Matter', clientName: 'Client', status: 'pending' });
    await db.insertCaseIntake({ caseId, firmId: FIRM_ID, state: 'ENGAGEMENT_LETTER_DRAFTED', conflictMatches: [] });

    const doc = await makeDocument(caseId);
    const request = await SignatureService.requestSignature(FIRM_ID, staffUser, {
      caseId, documentId: doc.id, signerName: 'Someone', signerEmail: 'someone@example.com'
    });
    const token = request.sign_path.split('token=')[1];
    await SignatureService.completeSigning(token, { typedName: 'Someone' }, {});

    const intake = await MatterIntakeService.getIntake(FIRM_ID, caseId);
    assert.equal(intake.state, 'ENGAGEMENT_LETTER_DRAFTED'); // unchanged — not the state this auto-advance applies to
  });
});
