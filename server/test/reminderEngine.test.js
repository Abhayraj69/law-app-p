const test = require('node:test');
const assert = require('node:assert/strict');
const { tasksForHearingUpdate, shiftDateString, FOLLOW_UP_LEAD_DAYS } = require('../services/reminderEngine');

// Pure functions, no database — these rules are what HearingService.
// logHearingUpdate hands to TaskService.createAutoTask; see that file's
// header comment for why the engine itself never touches Postgres.

test('shiftDateString moves a DATE-column string by N days without local-timezone drift', () => {
  assert.equal(shiftDateString('2026-03-10', -2), '2026-03-08');
  assert.equal(shiftDateString('2026-03-01', -2), '2026-02-27', 'must cross a month boundary correctly');
  assert.equal(shiftDateString('2026-12-31', 1), '2027-01-01', 'must cross a year boundary correctly');
});

test('tasksForHearingUpdate: no next date and no suggested draft produces no tasks', () => {
  const specs = tasksForHearingUpdate({ id: 'h1', case_id: 'C-1', next_hearing_date: null, suggested_draft: null });
  assert.deepEqual(specs, []);
});

test('tasksForHearingUpdate: a next_hearing_date produces one follow_up task due FOLLOW_UP_LEAD_DAYS earlier', () => {
  const specs = tasksForHearingUpdate({
    id: 'h1', case_id: 'C-1', purpose: 'Arguments', next_hearing_date: '2026-05-20', suggested_draft: null
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].task_type, 'follow_up');
  assert.equal(specs[0].due_date, shiftDateString('2026-05-20', -FOLLOW_UP_LEAD_DAYS));
  assert.equal(specs[0].case_id, 'C-1');
  assert.equal(specs[0].hearing_id, 'h1');
  assert.match(specs[0].title, /2026-05-20/);
});

test('tasksForHearingUpdate: a suggested_draft produces a draft_needed task due on the next hearing date', () => {
  const specs = tasksForHearingUpdate({
    id: 'h2', case_id: 'C-2', orders_passed: 'Adjourned for filing', next_hearing_date: '2026-06-01', suggested_draft: 'Adjournment Application'
  });
  const draftTask = specs.find(s => s.task_type === 'draft_needed');
  assert.ok(draftTask, 'a draft_needed task must be produced');
  assert.equal(draftTask.due_date, '2026-06-01');
  assert.match(draftTask.title, /Adjournment Application/);
  assert.match(draftTask.description, /Adjourned for filing/);
});

test('tasksForHearingUpdate: a suggested_draft with no next date leaves the draft task open-ended, not defaulted', () => {
  const specs = tasksForHearingUpdate({
    id: 'h3', case_id: 'C-3', next_hearing_date: null, suggested_draft: 'Exemption Application'
  });
  const draftTask = specs.find(s => s.task_type === 'draft_needed');
  assert.equal(draftTask.due_date, null, 'no fabricated due date when the hearing itself gave none');
});

test('tasksForHearingUpdate: both a next date AND a suggested draft produce two distinct tasks', () => {
  const specs = tasksForHearingUpdate({
    id: 'h4', case_id: 'C-4', next_hearing_date: '2026-07-15', suggested_draft: 'Stay Application'
  });
  assert.equal(specs.length, 2);
  const types = specs.map(s => s.task_type).sort();
  assert.deepEqual(types, ['draft_needed', 'follow_up']);
});
