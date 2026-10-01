const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Management Analytics tests (Phase 6 — firm-level reporting).
 *
 * Covers:
 *   - cases_by_status/cases_by_type reflect real counts;
 *   - staff_workload counts open tasks correctly per assignee and does NOT
 *     inflate hours-this-month due to the tasks/time_entries join fan-out
 *     the query is specifically written to avoid;
 *   - a CLIENT user never appears in the staff workload list;
 *   - hours_this_month only counts entries from the current month.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Management Analytics — cases, billing, staff workload', {
  skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance'
}, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const DashboardService = require('../services/dashboardService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const ASSOCIATE_ID = crypto.randomUUID();
  const CLIENT_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Management Analytics Test Firm', `mgmt-analytics-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const associate = await db.createUser({
    id: ASSOCIATE_ID, firmId: FIRM_ID, email: `associate-${ASSOCIATE_ID}@example.com`,
    fullName: 'Test Associate', role: 'ASSOCIATE', initials: 'TA', passwordHash
  });
  await db.createUser({
    id: CLIENT_ID, firmId: FIRM_ID, email: `client-${CLIENT_ID}@example.com`,
    fullName: 'Test Client', role: 'CLIENT', initials: 'TC', passwordHash
  });

  const caseActive1 = await db.insertCase({
    id: `MG-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Case One', clientName: 'Client A', caseType: 'Litigation'
  });
  const caseActive2 = await db.insertCase({
    id: `MG-B-${Date.now()}`, firmId: FIRM_ID, caseName: 'Case Two', clientName: 'Client B', caseType: 'Litigation'
  });
  await db.insertCase({
    id: `MG-C-${Date.now()}`, firmId: FIRM_ID, caseName: 'Case Three', clientName: 'Client C',
    status: 'closed', caseType: 'Corporate'
  });

  // Two open tasks and one done task assigned to the associate — done
  // tasks must not count toward open_tasks.
  await db.insertTask({
    firmId: FIRM_ID, caseId: caseActive1.id, title: 'Task 1', taskType: 'general',
    assignedToUserId: ASSOCIATE_ID, createdByUserId: ASSOCIATE_ID
  });
  await db.insertTask({
    firmId: FIRM_ID, caseId: caseActive2.id, title: 'Task 2', taskType: 'general',
    assignedToUserId: ASSOCIATE_ID, createdByUserId: ASSOCIATE_ID
  });
  const doneTask = await db.insertTask({
    firmId: FIRM_ID, caseId: caseActive1.id, title: 'Task 3 (done)', taskType: 'general',
    assignedToUserId: ASSOCIATE_ID, createdByUserId: ASSOCIATE_ID
  });
  await db.updateTaskFields(FIRM_ID, doneTask.id, { status: 'done' });

  // Three time entries this month across two cases — SUM must be exactly
  // their total, not multiplied by the number of open tasks (the fan-out
  // this query's separate-subquery design specifically avoids).
  await pool.query(
    `INSERT INTO time_entries (firm_id, case_id, user_id, entry_date, minutes, rate_cents, description)
     VALUES ($1, $2, $3, CURRENT_DATE, 60, 10000, 'Work A'),
            ($1, $2, $3, CURRENT_DATE, 90, 10000, 'Work B'),
            ($1, $4, $3, CURRENT_DATE, 30, 10000, 'Work C')`,
    [FIRM_ID, caseActive1.id, ASSOCIATE_ID, caseActive2.id]
  );
  // A last-month entry that must NOT count toward hours_this_month.
  await pool.query(
    `INSERT INTO time_entries (firm_id, case_id, user_id, entry_date, minutes, rate_cents, description)
     VALUES ($1, $2, $3, (date_trunc('month', CURRENT_DATE) - INTERVAL '1 day')::date, 500, 10000, 'Old work')`,
    [FIRM_ID, caseActive1.id, ASSOCIATE_ID]
  );

  await t.test('cases_by_status and cases_by_type reflect real counts', async () => {
    const analytics = await DashboardService.getManagementAnalytics(FIRM_ID);
    const activeRow = analytics.cases_by_status.find(r => r.status === 'active');
    const closedRow = analytics.cases_by_status.find(r => r.status === 'closed');
    assert.equal(activeRow.count, 2);
    assert.equal(closedRow.count, 1);

    const litigationRow = analytics.cases_by_type.find(r => r.case_type === 'Litigation');
    assert.equal(litigationRow.count, 2);
  });

  await t.test('staff_workload counts open tasks and hours without join fan-out', async () => {
    const analytics = await DashboardService.getManagementAnalytics(FIRM_ID);
    const row = analytics.staff_workload.find(w => w.user_id === ASSOCIATE_ID);
    assert.ok(row);
    assert.equal(row.open_tasks, 2, 'the done task must not count');
    // 60 + 90 + 30 = 180 minutes = 3.0 hours this month, excluding the
    // last-month 500-minute entry and NOT multiplied by 2 open tasks.
    assert.equal(row.hours_this_month, 3.0);
  });

  await t.test('a CLIENT never appears in the staff workload list', async () => {
    const analytics = await DashboardService.getManagementAnalytics(FIRM_ID);
    assert.ok(!analytics.staff_workload.some(w => w.user_id === CLIENT_ID));
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
