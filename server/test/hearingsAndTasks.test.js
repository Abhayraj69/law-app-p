const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Hearing log + task/reminder engine tests.
 *
 * Covers:
 *   - scheduling a hearing and the associate-facing structured update
 *     (logHearingUpdate) moving it out of 'scheduled';
 *   - the reminder engine actually running on a logged update and
 *     producing the right tasks (follow_up / draft_needed), and staying
 *     idempotent across a second, corrective update to the same hearing;
 *   - case ownership scoping for hearings (CLIENT gets 404, not another
 *     client's hearings);
 *   - task CRUD and the "overdue" view field being computed, not stored;
 *   - the three new dashboard ops metrics (listed this week, non-updated
 *     after hearing, awaiting draft), including that they're null for a
 *     CLIENT viewer.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Hearing log and task/reminder engine', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const HearingService = require('../services/hearingService');
  const TaskService = require('../services/taskService');
  const DashboardService = require('../services/dashboardService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const ASSOCIATE_ID = crypto.randomUUID();
  const CLIENT_ID = crypto.randomUUID();
  const OTHER_CLIENT_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Hearings Test Firm', `hearings-${FIRM_ID}.example`
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
    id: `HR-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Case A', clientName: 'Client A',
    clientUserId: CLIENT_ID
  });

  function daysFromNow(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // ───────────────────────────────────────────────────────────
  // Scheduling and the structured update
  // ───────────────────────────────────────────────────────────

  let hearing;
  await t.test('a hearing can be scheduled against a real case', async () => {
    hearing = await HearingService.createHearing(FIRM_ID, associate, {
      case_id: caseA.id, hearing_date: daysFromNow(-1), court_hall: 'Court Hall 3', purpose: 'Arguments'
    });
    assert.equal(hearing.status, 'scheduled');
    assert.equal(hearing.case_id, caseA.id);
  });

  await t.test('case_id and hearing_date are required', async () => {
    await assert.rejects(() => HearingService.createHearing(FIRM_ID, associate, { hearing_date: daysFromNow(1) }), (err) => err.status === 400);
    await assert.rejects(() => HearingService.createHearing(FIRM_ID, associate, { case_id: caseA.id }), (err) => err.status === 400);
  });

  await t.test('a hearing cannot be scheduled against a case that does not exist', async () => {
    await assert.rejects(
      () => HearingService.createHearing(FIRM_ID, associate, { case_id: 'NO-SUCH-CASE', hearing_date: daysFromNow(1) }),
      (err) => err.status === 404
    );
  });

  await t.test('logHearingUpdate defaults status to held and stamps the updating user', async () => {
    const updated = await HearingService.logHearingUpdate(FIRM_ID, associate, hearing.id, {
      submissions: 'Arguments on maintainability', orders_passed: 'Adjourned', next_hearing_date: daysFromNow(14)
    });
    assert.equal(updated.status, 'held', 'a structured update with no explicit status must move OFF scheduled');
    assert.equal(updated.updated_by_user_id, ASSOCIATE_ID);
    assert.equal(updated.submissions, 'Arguments on maintainability');
    hearing = updated;
  });

  await t.test('an invalid risk_flag or status is rejected', async () => {
    await assert.rejects(() => HearingService.logHearingUpdate(FIRM_ID, associate, hearing.id, { risk_flag: 'not-a-flag' }), (err) => err.status === 400);
    await assert.rejects(() => HearingService.logHearingUpdate(FIRM_ID, associate, hearing.id, { status: 'not-a-status' }), (err) => err.status === 400);
  });

  // ───────────────────────────────────────────────────────────
  // Reminder engine: run via logHearingUpdate, idempotent on re-log
  // ───────────────────────────────────────────────────────────

  await t.test('logging an update with a next_hearing_date creates a follow_up task', async () => {
    const tasks = await TaskService.listTasks(FIRM_ID, { case_id: caseA.id, task_type: 'follow_up' });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].hearing_id, hearing.id);
    assert.equal(tasks[0].auto_generated, true);
  });

  await t.test('logging an update with a suggested_draft creates a draft_needed task', async () => {
    await HearingService.logHearingUpdate(FIRM_ID, associate, hearing.id, { suggested_draft: 'Adjournment Application' });
    const tasks = await TaskService.listTasks(FIRM_ID, { case_id: caseA.id, task_type: 'draft_needed' });
    assert.equal(tasks.length, 1);
    assert.match(tasks[0].title, /Adjournment Application/);
  });

  await t.test('logging a corrective update again does not duplicate the auto-generated tasks', async () => {
    await HearingService.logHearingUpdate(FIRM_ID, associate, hearing.id, {
      next_hearing_date: daysFromNow(21), suggested_draft: 'Adjournment Application'
    });
    const followUps = await TaskService.listTasks(FIRM_ID, { case_id: caseA.id, task_type: 'follow_up' });
    const draftTasks = await TaskService.listTasks(FIRM_ID, { case_id: caseA.id, task_type: 'draft_needed' });
    assert.equal(followUps.length, 1, 'must refresh the existing follow_up task in place, not create a second');
    assert.equal(draftTasks.length, 1, 'must refresh the existing draft_needed task in place, not create a second');
  });

  await t.test('a task marked done is no longer refreshed by a later update — a fresh one is created instead', async () => {
    const [draftTask] = await TaskService.listTasks(FIRM_ID, { case_id: caseA.id, task_type: 'draft_needed' });
    await TaskService.updateTask(FIRM_ID, associate, draftTask.id, { status: 'done' });

    await HearingService.logHearingUpdate(FIRM_ID, associate, hearing.id, { suggested_draft: 'Second Draft Needed' });

    const draftTasks = await TaskService.listTasks(FIRM_ID, { case_id: caseA.id, task_type: 'draft_needed' });
    assert.equal(draftTasks.length, 2, 'a completed auto task must not block a new one from being created');
    const open = draftTasks.filter(t2 => t2.status !== 'done');
    assert.equal(open.length, 1);
    assert.match(open[0].title, /Second Draft Needed/);
  });

  // ───────────────────────────────────────────────────────────
  // Task view shape
  // ───────────────────────────────────────────────────────────

  await t.test('a task view reports overdue as computed, not stored', async () => {
    const manual = await TaskService.createTask(FIRM_ID, associate, {
      case_id: caseA.id, title: 'Overdue manual task', due_date: daysFromNow(-5)
    });
    assert.equal(manual.overdue, true);

    const future = await TaskService.createTask(FIRM_ID, associate, {
      case_id: caseA.id, title: 'Future manual task', due_date: daysFromNow(5)
    });
    assert.equal(future.overdue, false);

    await TaskService.updateTask(FIRM_ID, associate, manual.id, { status: 'done' });
    const afterDone = (await TaskService.listTasks(FIRM_ID, { case_id: caseA.id })).find(t2 => t2.id === manual.id);
    assert.equal(afterDone.overdue, false, 'a done task is never overdue, no matter how far past its due date');
  });

  await t.test('task title is required and task_type/status are validated against the fixed set', async () => {
    await assert.rejects(() => TaskService.createTask(FIRM_ID, associate, { title: '   ' }), (err) => err.status === 400);
    await assert.rejects(() => TaskService.createTask(FIRM_ID, associate, { title: 'x', task_type: 'not-a-type' }), (err) => err.status === 400);
    const t2 = await TaskService.createTask(FIRM_ID, associate, { title: 'valid task' });
    await assert.rejects(() => TaskService.updateTask(FIRM_ID, associate, t2.id, { status: 'not-a-status' }), (err) => err.status === 400);
  });

  await t.test('deleting an unknown task 404s', async () => {
    await assert.rejects(() => TaskService.deleteTask(FIRM_ID, associate, crypto.randomUUID()), (err) => err.status === 404);
  });

  // ───────────────────────────────────────────────────────────
  // Case ownership scoping for hearings
  // ───────────────────────────────────────────────────────────

  await t.test('the owning client can list hearings for their own case', async () => {
    const hearings = await HearingService.listHearingsForCase(FIRM_ID, caseA.id, client);
    assert.ok(hearings.some(h => h.id === hearing.id));
  });

  await t.test('a different client gets a 404, not an empty list, for a case that is not theirs', async () => {
    await assert.rejects(
      () => HearingService.listHearingsForCase(FIRM_ID, caseA.id, otherClient),
      (err) => err.status === 404
    );
  });

  // ───────────────────────────────────────────────────────────
  // Dashboard ops metrics
  // ───────────────────────────────────────────────────────────

  await t.test('dashboard ops metrics report the non-updated-after-hearing and awaiting-draft counts for staff', async () => {
    // A second hearing whose date has passed but was never logged.
    await HearingService.createHearing(FIRM_ID, associate, {
      case_id: caseA.id, hearing_date: daysFromNow(-3), purpose: 'Never followed up'
    });
    // A hearing listed within the coming week.
    await HearingService.createHearing(FIRM_ID, associate, {
      case_id: caseA.id, hearing_date: daysFromNow(3), purpose: 'Upcoming this week'
    });

    const summary = await DashboardService.getSummary(FIRM_ID, associate);
    assert.ok(summary.ops, 'a staff viewer must receive ops metrics');
    assert.ok(summary.ops.not_updated_after_hearing >= 1, 'the un-logged past hearing must be counted');
    assert.ok(summary.ops.listed_this_week >= 1, 'the upcoming-this-week hearing must be counted');
    assert.ok(summary.ops.awaiting_draft >= 1, 'the still-open draft_needed task must be counted');
  });

  await t.test('dashboard ops metrics are null for a CLIENT viewer', async () => {
    const summary = await DashboardService.getSummary(FIRM_ID, client);
    assert.equal(summary.ops, null);
  });

  // ───────────────────────────────────────────────────────────
  // Audit trail
  // ───────────────────────────────────────────────────────────

  await t.test('hearing and task actions are all written to the audit log', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT action::text AS action FROM audit_logs WHERE firm_id = $1 AND (action::text LIKE '%HEARING%' OR action::text LIKE '%TASK%')`,
      [FIRM_ID]
    );
    const actions = new Set(rows.map(r => r.action));
    assert.ok(actions.has('CREATE_HEARING'));
    assert.ok(actions.has('UPDATE_HEARING'));
    assert.ok(actions.has('CREATE_TASK'));
    assert.ok(actions.has('UPDATE_TASK'));
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
