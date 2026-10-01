const test = require('node:test');
const assert = require('node:assert/strict');
const { computeRiskFlag, URGENT_WITHIN_DAYS, WATCH_WITHIN_DAYS } = require('../services/limitationWatchEngine');

/**
 * Pure-function tests for the limitation watch engine — no database
 * needed, same reasoning reminderEngine.test.js gives for testing its
 * rules without Postgres.
 */

test('Limitation Watch Engine — computeRiskFlag', async (t) => {
  const TODAY = '2026-06-15';

  await t.test('a resolved deadline is always none, regardless of date', () => {
    assert.equal(computeRiskFlag({ limitation_date: '2026-06-16', status: 'resolved' }, TODAY), 'none');
    assert.equal(computeRiskFlag({ limitation_date: '2020-01-01', status: 'resolved' }, TODAY), 'none');
  });

  await t.test('a lapsed (past) open deadline is urgent', () => {
    assert.equal(computeRiskFlag({ limitation_date: '2026-06-01', status: 'open' }, TODAY), 'urgent');
  });

  await t.test(`within ${URGENT_WITHIN_DAYS} days is urgent`, () => {
    assert.equal(computeRiskFlag({ limitation_date: '2026-06-15', status: 'open' }, TODAY), 'urgent');
    assert.equal(computeRiskFlag({ limitation_date: '2026-06-29', status: 'open' }, TODAY), 'urgent');
  });

  await t.test(`between ${URGENT_WITHIN_DAYS + 1} and ${WATCH_WITHIN_DAYS} days is watch`, () => {
    assert.equal(computeRiskFlag({ limitation_date: '2026-06-30', status: 'open' }, TODAY), 'watch');
    assert.equal(computeRiskFlag({ limitation_date: '2026-07-30', status: 'open' }, TODAY), 'watch');
  });

  await t.test(`beyond ${WATCH_WITHIN_DAYS} days is none`, () => {
    assert.equal(computeRiskFlag({ limitation_date: '2026-07-31', status: 'open' }, TODAY), 'none');
    assert.equal(computeRiskFlag({ limitation_date: '2027-01-01', status: 'open' }, TODAY), 'none');
  });
});
