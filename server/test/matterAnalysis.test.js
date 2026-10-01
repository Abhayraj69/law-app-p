const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Matter Analysis tests (Phase 3 — chronology, issue matrix, remedy
 * outline).
 *
 * Covers:
 *   - generation reads real case documents + hearings and persists a new
 *     matter_analyses row, source-linked back to real document/hearing ids;
 *   - a citation the AI response points at that ISN'T a real id on this
 *     matter is dropped rather than surfaced (the hallucination guard);
 *   - remedy_outline generation auto-generates chronology/issue_matrix if
 *     neither exists yet, rather than requiring three separate clicks;
 *   - case ownership scoping: a different client gets 404, not another
 *     client's analysis;
 *   - the overview endpoint returns the latest of each type;
 *   - every generation is written to the audit log.
 *
 * The AI provider itself is monkey-patched (aiProvider.isConfigured /
 * aiProvider.chatCompletion) rather than hitting a real LLM, since this
 * needs deterministic, hallucination-testable output — the same "the real
 * mechanism under test is our own filtering, not a live model" reasoning
 * copilotChat.test.js uses for its extraction tests.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Matter Analysis — chronology, issue matrix, remedy outline', {
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
  const MatterAnalysisService = require('../services/matterAnalysisService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const ASSOCIATE_ID = crypto.randomUUID();
  const CLIENT_ID = crypto.randomUUID();
  const OTHER_CLIENT_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Matter Analysis Test Firm', `matter-analysis-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const associate = await db.createUser({
    id: ASSOCIATE_ID, firmId: FIRM_ID, email: `associate-${ASSOCIATE_ID}@example.com`,
    fullName: 'Test Associate', role: 'ASSOCIATE', initials: 'TA', passwordHash
  });
  const client = await db.createUser({
    id: CLIENT_ID, firmId: FIRM_ID, email: `client-${CLIENT_ID}@example.com`,
    fullName: 'Test Client', role: 'CLIENT', initials: 'TC', passwordHash
  });
  const otherClient = await db.createUser({
    id: OTHER_CLIENT_ID, firmId: FIRM_ID, email: `other-client-${OTHER_CLIENT_ID}@example.com`,
    fullName: 'Other Client', role: 'CLIENT', initials: 'OC', passwordHash
  });

  const caseA = await db.insertCase({
    id: `MA-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Matter Analysis Case', clientName: 'Client A',
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

  const hearing = await HearingService.createHearing(FIRM_ID, associate, {
    case_id: caseA.id, hearing_date: '2026-02-10', purpose: 'First hearing'
  });

  // ─── Monkey-patch the AI provider for deterministic, testable output ───
  const originalIsConfigured = aiProvider.isConfigured;
  const originalChatCompletion = aiProvider.chatCompletion;
  t.after(() => {
    aiProvider.isConfigured = originalIsConfigured;
    aiProvider.chatCompletion = originalChatCompletion;
  });
  aiProvider.isConfigured = () => true;

  await t.test('chronology generation persists real citations and drops a hallucinated one', async () => {
    aiProvider.chatCompletion = async () => JSON.stringify({
      events: [
        { date: '2026-01-05', description: 'Complaint filed', source_type: 'document', source_id: doc.id },
        { date: '2026-02-10', description: 'First hearing held', source_type: 'hearing', source_id: hearing.id },
        // Not a real id on this matter — must be dropped, not surfaced.
        { date: '2026-03-01', description: 'Invented event', source_type: 'document', source_id: crypto.randomUUID() }
      ]
    });

    const result = await MatterAnalysisService.generate(FIRM_ID, associate, caseA.id, 'chronology');
    assert.equal(result.analysis_type, 'chronology');
    assert.equal(result.content.events.length, 2, 'the hallucinated citation must be filtered out');
    assert.ok(result.content.events.some(e => e.source.source_id === doc.id));
    assert.ok(result.content.events.some(e => e.source.source_id === hearing.id));
    assert.ok(!result.content.events.some(e => e.description === 'Invented event'));
  });

  await t.test('an issue whose sources are ALL hallucinated is dropped entirely', async () => {
    aiProvider.chatCompletion = async () => JSON.stringify({
      issues: [
        { issue: 'Breach of contract', description: 'Real issue', sources: [{ source_type: 'document', source_id: doc.id }] },
        { issue: 'Fabricated issue', description: 'No real source', sources: [{ source_type: 'document', source_id: crypto.randomUUID() }] }
      ]
    });

    const result = await MatterAnalysisService.generate(FIRM_ID, associate, caseA.id, 'issue_matrix');
    assert.equal(result.content.issues.length, 1);
    assert.equal(result.content.issues[0].issue, 'Breach of contract');
  });

  await t.test('remedy_outline reuses the just-generated chronology/issue_matrix rather than regenerating them', async () => {
    let chatCallCount = 0;
    aiProvider.chatCompletion = async () => {
      chatCallCount += 1;
      return JSON.stringify({
        sections: [
          { heading: 'Relief Sought', content: 'Damages for breach of contract.', sources: [{ source_type: 'document', source_id: doc.id }] }
        ]
      });
    };

    const result = await MatterAnalysisService.generate(FIRM_ID, associate, caseA.id, 'remedy_outline');
    assert.equal(chatCallCount, 1, 'must not re-generate chronology/issue_matrix that already exist');
    assert.equal(result.content.sections.length, 1);
    assert.ok(result.content.built_from.chronology_id);
    assert.ok(result.content.built_from.issue_matrix_id);
  });

  await t.test('remedy_outline auto-generates missing chronology/issue_matrix for a fresh case', async () => {
    const caseB = await db.insertCase({
      id: `MA-B-${Date.now()}`, firmId: FIRM_ID, caseName: 'Fresh Case', clientName: 'Client A',
      clientUserId: CLIENT_ID
    });
    const { document: docB } = await VaultService.initiateUpload(
      FIRM_ID, ASSOCIATE_ID,
      { buffer: Buffer.from('NOTICE\n\nServed 2026-04-01.', 'utf8'), size: 40, mimetype: 'text/plain', originalname: 'notice.txt' },
      { case_id: caseB.id }
    );

    aiProvider.chatCompletion = async (messages) => {
      const userMsg = messages[1].content;
      if (userMsg.includes('Draft the remedy outline now')) {
        return JSON.stringify({ sections: [{ heading: 'Relief', content: 'Outline', sources: [{ source_type: 'document', source_id: docB.id }] }] });
      }
      if (userMsg.includes('Build the issue matrix now')) {
        return JSON.stringify({ issues: [{ issue: 'Notice validity', description: 'x', sources: [{ source_type: 'document', source_id: docB.id }] }] });
      }
      return JSON.stringify({ events: [{ date: '2026-04-01', description: 'Notice served', source_type: 'document', source_id: docB.id }] });
    };

    const result = await MatterAnalysisService.generate(FIRM_ID, associate, caseB.id, 'remedy_outline');
    assert.equal(result.analysis_type, 'remedy_outline');
    assert.equal(result.content.sections.length, 1);

    const overview = await MatterAnalysisService.getOverview(FIRM_ID, caseB.id, associate);
    assert.ok(overview.chronology, 'chronology must have been auto-generated');
    assert.ok(overview.issue_matrix, 'issue_matrix must have been auto-generated');
    assert.ok(overview.remedy_outline);
  });

  await t.test('overview returns the latest of each analysis type for the owning client', async () => {
    const overview = await MatterAnalysisService.getOverview(FIRM_ID, caseA.id, client);
    assert.equal(overview.chronology.analysis_type, 'chronology');
    assert.equal(overview.issue_matrix.analysis_type, 'issue_matrix');
    assert.equal(overview.remedy_outline.analysis_type, 'remedy_outline');
  });

  await t.test('a different client gets a 404, not another client\'s analysis', async () => {
    await assert.rejects(
      () => MatterAnalysisService.getOverview(FIRM_ID, caseA.id, otherClient),
      (err) => err.status === 404
    );
    await assert.rejects(
      () => MatterAnalysisService.generate(FIRM_ID, otherClient, caseA.id, 'chronology'),
      (err) => err.status === 404
    );
  });

  await t.test('an invalid analysis_type is rejected', async () => {
    await assert.rejects(
      () => MatterAnalysisService.getLatest(FIRM_ID, caseA.id, 'not-a-type', associate),
      (err) => err.status === 400
    );
  });

  await t.test('every generation is written to the audit log', async () => {
    const { rows } = await pool.query(
      `SELECT details FROM audit_logs WHERE firm_id = $1 AND action::text = 'GENERATE_MATTER_ANALYSIS'`,
      [FIRM_ID]
    );
    const types = new Set(rows.map(r => r.details.analysis_type));
    assert.ok(types.has('chronology'));
    assert.ok(types.has('issue_matrix'));
    assert.ok(types.has('remedy_outline'));
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
