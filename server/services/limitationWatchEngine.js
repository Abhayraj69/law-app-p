/**
 * Limitation Watch Engine
 *
 * Phase 6's proactive risk flag for statute-of-limitations deadlines, kept
 * deliberately small the same way reminderEngine.js is: a pure function
 * with no I/O, so its rule is testable without Postgres (see
 * server/test/limitationWatch.test.js) and LimitationService owns turning
 * it into an API response.
 *
 * risk_flag is computed fresh on every read, never stored — see
 * 0029_limitation_watch.sql's header for why (no background job runner
 * exists in this app to keep a stored value from going stale).
 */

const URGENT_WITHIN_DAYS = 14;
const WATCH_WITHIN_DAYS = 45;

// Same string-arithmetic approach reminderEngine.shiftDateString uses, for
// the same reason: avoids the local-timezone-midnight footgun on a DATE
// column string.
function daysUntil(dateStr, todayStr) {
  const target = new Date(`${dateStr}T00:00:00Z`);
  const today = new Date(`${todayStr}T00:00:00Z`);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * @param {{ limitation_date: string, status: 'open'|'resolved' }} deadline
 * @param {string} [todayStr] - 'YYYY-MM-DD', defaults to the real today (UTC)
 * @returns {'none'|'watch'|'urgent'}
 */
function computeRiskFlag(deadline, todayStr = new Date().toISOString().slice(0, 10)) {
  if (deadline.status === 'resolved') return 'none';

  const remaining = daysUntil(deadline.limitation_date, todayStr);
  if (remaining <= URGENT_WITHIN_DAYS) return 'urgent'; // includes already-lapsed (negative)
  if (remaining <= WATCH_WITHIN_DAYS) return 'watch';
  return 'none';
}

module.exports = { computeRiskFlag, daysUntil, URGENT_WITHIN_DAYS, WATCH_WITHIN_DAYS };
