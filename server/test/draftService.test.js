const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Draft Service tests (Phase 4 — drafting automation).
 *
 * Covers:
 *   - logging a hearing update with suggested_draft produces a
 *     'draft_needed' task (Phase 1 wiring this phase builds on);
 *   - generating from that task infers the template from the task title,
 *     auto-generates chronology/issue_matrix if neither exists yet (Phase 3
 *     dependency), and persists a new drafts row source-linked to real
 *     document/hearing ids;
 *   - a citation the AI response points at that ISN'T a real id on this
 *     matter is dropped rather than surfaced (the hallucination guard,
 *     same convention as matterAnalysis.test.js);
 *   - generating from a task moves it to 'in_progress'; approving a draft
 *     moves the task to 'done'; rejecting a draft reopens the task so it
 *     can be regenerated;
 *   - a draft is never usable outside pending_review -> approved/rejected
 *     (the WRONG_STATE guard);
 *   - case ownership scoping: a different client gets 404;
 *   - every generate/approve/reject is written to the audit log.
 *
 * The AI provider is monkey-patched, same reasoning as matterAnalysis.test.js.
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Draft Service — drafting automation', {
  skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance'
}, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const VaultService = require('../services/vaultService');
  const HearingService = require('../services/hearingService');
  const aiProvider = require('../services/aiProvider');
  const DraftService = require('../services/draftService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const ASSOCIATE_ID = crypto.randomUUID();
  const PARTNER_ID = crypto.randomUUID();
  const CLIENT_ID = crypto.randomUUID();
  const OTHER_CLIENT_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Draft Service Test Firm', `draft-service-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const associate = await db.createUser({
    id: ASSOCIATE_ID, firmId: FIRM_ID, email: `associate-${ASSOCIATE_ID}@example.com`,
    fullName: 'Test Associate', role: 'ASSOCIATE', initials: 'TA', passwordHash
  });
  const partner = await db.createUser({
    id: PARTNER_ID, firmId: FIRM_ID, email: `partner-${PARTNER_ID}@example.com`,
    fullName: 'Test Partner', role: 'PARTNER', initials: 'TP', passwordHash
  });
  await db.createUser({
    id: CLIENT_ID, firmId: FIRM_ID, email: `client-${CLIENT_ID}@example.com`,
    fullName: 'Test Client', role: 'CLIENT', initials: 'TC', passwordHash
  });
  const otherClient = await db.createUser({
    id: OTHER_CLIENT_ID, firmId: FIRM_ID, email: `other-client-${OTHER_CLIENT_ID}@example.com`,
    fullName: 'Other Client', role: 'CLIENT', initials: 'OC', passwordHash
  });

  const caseA = await db.insertCase({
    id: `DR-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Draft Service Case', clientName: 'Client A',
    clientUserId: CLIENT_ID
  });

  const { document: doc } = await VaultService.initiateUpload(
    FIRM_ID, ASSOCIATE_ID,
    {
      buffer: Buffer.from('COMPLAINT\n\nFiled on 2026-01-05. Plaintiff alleges breach of contract.', 'utf8'),
      size: 100, mimetype: 'text/plain', originalname: 'complaint.txt'
    },
    { case_id: caseA.id }
  );

  // ─── Monkey-patch the AI provider for deterministic, testable output ───
  const originalIsConfigured = aiProvider.isConfigured;
  const originalChatCompletion = aiProvider.chatCompletion;
  t.after(() => {
    aiProvider.isConfigured = originalIsConfigured;
    aiProvider.chatCompletion = originalChatCompletion;
  });
  aiProvider.isConfigured = () => true;

  let hearing;
  let draftNeededTask;

  await t.test('logging a hearing update with suggested_draft produces a draft_needed task', async () => {
    hearing = await HearingService.createHearing(FIRM_ID, associate, {
      case_id: caseA.id, hearing_date: '2026-02-10', purpose: 'First hearing'
    });
    await HearingService.logHearingUpdate(FIRM_ID, associate, hearing.id, {
      submissions: 'Plaintiff sought interim relief.',
      orders_passed: 'Court directed status quo.',
      next_hearing_date: '2026-03-01',
      suggested_draft: 'Stay Application'
    });

    const tasks = await db.listTasksForFirm(FIRM_ID, { caseId: caseA.id, taskType: 'draft_needed' });
    assert.equal(tasks.length, 1);
    draftNeededTask = tasks[0];
    assert.equal(draftNeededTask.status, 'open');
    assert.match(draftNeededTask.title, /Stay Application/);
  });

  await t.test('generating from the task infers the template, auto-builds chronology/issue_matrix, and drops a hallucinated citation', async () => {
    aiProvider.chatCompletion = async (messages) => {
      const userMsg = messages[1].content;
      if (userMsg.includes('Draft the') && userMsg.includes('now, as JSON only')) {
        return JSON.stringify({
          sections: [
            {
              heading: 'Order/Proceeding Sought to be Stayed', content: 'The order dated 2026-02-10.',
              sources: [
                { source_type: 'document', source_id: doc.id },
                // Not a real id on this matter — must be dropped, not surfaced.
                { source_type: 'document', source_id: crypto.randomUUID() }
              ]
            },
            { heading: 'Grounds for Stay', content: 'Balance of convenience favors the plaintiff.', sources: [{ source_type: 'hearing', source_id: hearing.id }] },
            { heading: 'Prayer', content: 'Stay the order pending disposal.', sources: [{ source_type: 'document', source_id: doc.id }] }
          ]
        });
      }
      if (userMsg.includes('Build the issue matrix now')) {
        return JSON.stringify({ issues: [{ issue: 'Breach of contract', description: 'x', sources: [{ source_type: 'document', source_id: doc.id }] }] });
      }
      return JSON.stringify({ events: [{ date: '2026-01-05', description: 'Complaint filed', source_type: 'document', source_id: doc.id }] });
    };

    const draft = await DraftService.generateFromTask(FIRM_ID, associate, draftNeededTask.id, {});
    assert.equal(draft.template_key, 'stay');
    assert.equal(draft.status, 'pending_review');
    assert.equal(draft.content.sections.length, 3);
    const stayedSection = draft.content.sections.find(s => s.heading === 'Order/Proceeding Sought to be Stayed');
    assert.equal(stayedSection.sources.length, 1, 'the hallucinated citation must be filtered out');
    assert.equal(stayedSection.sources[0].source_id, doc.id);
    assert.ok(draft.content.built_from.chronology_id);
    assert.ok(draft.content.built_from.issue_matrix_id);

    const refreshedTask = await db.getTaskById(FIRM_ID, draftNeededTask.id);
    assert.equal(refreshedTask.status, 'in_progress', 'generating a draft moves the task out of open');

    global.__generatedDraftId = draft.id;
  });

  await t.test('a draft cannot be approved or rejected twice (WRONG_STATE)', async () => {
    const draftId = global.__generatedDraftId;
    await DraftService.rejectDraft(FIRM_ID, partner, draftId, 'Needs stronger grounds.');

    const refreshedTask = await db.getTaskById(FIRM_ID, draftNeededTask.id);
    assert.equal(refreshedTask.status, 'open', 'rejecting a draft reopens its task for regeneration');

    await assert.rejects(
      () => DraftService.approveDraft(FIRM_ID, partner, draftId),
      (err) => err.status === 409 && err.code === 'WRONG_STATE'
    );
  });

  await t.test('regenerating after rejection creates a new row and approving it marks the task done', async () => {
    aiProvider.chatCompletion = async () => JSON.stringify({
      sections: [{ heading: 'Prayer', content: 'Stay the order pending disposal.', sources: [{ source_type: 'document', source_id: doc.id }] }]
    });

    const secondDraft = await DraftService.generateFromTask(FIRM_ID, associate, draftNeededTask.id, { template_key: 'stay' });
    assert.notEqual(secondDraft.id, global.__generatedDraftId);

    const approved = await DraftService.approveDraft(FIRM_ID, partner, secondDraft.id);
    assert.equal(approved.status, 'approved');

    const finalTask = await db.getTaskById(FIRM_ID, draftNeededTask.id);
    assert.equal(finalTask.status, 'done');
  });

  await t.test('an explicit invalid template_key is rejected', async () => {
    await assert.rejects(
      () => DraftService.generateFromTask(FIRM_ID, associate, draftNeededTask.id, { template_key: 'not-a-template' }),
      (err) => err.status === 400
    );
  });

  await t.test('a different client gets a 404, not this matter\'s draft', async () => {
    await assert.rejects(
      () => DraftService.getDraft(FIRM_ID, global.__generatedDraftId, otherClient),
      (err) => err.status === 404
    );
  });

  await t.test('listDraftsForCase returns every generation, newest first', async () => {
    const drafts = await DraftService.listDraftsForCase(FIRM_ID, caseA.id, associate);
    assert.equal(drafts.length, 2);
    assert.ok(new Date(drafts[0].created_at) >= new Date(drafts[1].created_at));
  });

  await t.test('every generate/approve/reject is written to the audit log', async () => {
    const { rows } = await pool.query(
      `SELECT action::text AS action FROM audit_logs WHERE firm_id = $1 AND action::text IN ('GENERATE_DRAFT', 'APPROVE_DRAFT', 'REJECT_DRAFT')`,
      [FIRM_ID]
    );
    const actions = rows.map(r => r.action);
    assert.ok(actions.includes('GENERATE_DRAFT'));
    assert.ok(actions.includes('APPROVE_DRAFT'));
    assert.ok(actions.includes('REJECT_DRAFT'));
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
