/**
 * Reminder Engine
 *
 * Phase 1's "rules-based reminder engine," kept deliberately small: pure
 * functions that look at a hearing row and decide what follow-up tasks it
 * implies, with no I/O of their own. HearingService calls this after a
 * structured update is logged and hands the resulting specs to
 * TaskService.createAutoTask — the engine itself never touches the
 * database, so its rules are testable without Postgres (see
 * server/test/reminderEngine.test.js).
 *
 * "Reminder" means a task that shows up as due/overdue when a task list or
 * the dashboard is read — there is no cron/job runner anywhere in this app
 * (checked before writing this), and notification channels (email/SMS) are
 * explicitly Phase 6. Building either here would be solving a problem this
 * phase doesn't have yet.
 */

const FOLLOW_UP_LEAD_DAYS = 2;

// `dateStr` is a 'YYYY-MM-DD' DATE-column string — shifting it as a string
// via Date arithmetic and re-slicing avoids the local-timezone-midnight
// footgun documented in caseService.js's formatHearingDate/deadlineStatus
// (this codebase's own established fix for that class of bug).
function shiftDateString(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Given a hearing row (post-update — i.e. what HearingService.logHearingUpdate
 * is about to save), returns zero or more task specs the reminder engine
 * wants created. Each spec is shaped for TaskService.createAutoTask, not
 * for a raw DB insert — HearingService/TaskService own turning it into a row.
 *
 * Two rules today, both directly off fields an associate fills in on the
 * structured update form:
 *
 *   1. A next_hearing_date was given → a 'follow_up' task due
 *      FOLLOW_UP_LEAD_DAYS before it, so preparing for the next appearance
 *      doesn't get discovered only on the day itself.
 *   2. A suggested_draft was named → a 'draft_needed' task, due on the
 *      next hearing date if one was given (there's a real deadline to draft
 *      against) or left open-ended otherwise. This is exactly what backs
 *      the dashboard's "awaiting draft" count — Phase 4 is what turns this
 *      task into an actual generated draft; this phase only flags that one
 *      is needed.
 */
function tasksForHearingUpdate(hearing) {
  const specs = [];

  if (hearing.next_hearing_date) {
    specs.push({
      title: `Prepare for next hearing (${hearing.next_hearing_date})`,
      description: hearing.purpose ? `Follow-up on: ${hearing.purpose}` : null,
      task_type: 'follow_up',
      due_date: shiftDateString(hearing.next_hearing_date, -FOLLOW_UP_LEAD_DAYS),
      case_id: hearing.case_id,
      hearing_id: hearing.id
    });
  }

  if (hearing.suggested_draft) {
    specs.push({
      title: `Draft needed: ${hearing.suggested_draft}`,
      description: hearing.orders_passed ? `Per order: ${hearing.orders_passed}` : null,
      task_type: 'draft_needed',
      due_date: hearing.next_hearing_date || null,
      case_id: hearing.case_id,
      hearing_id: hearing.id
    });
  }

  return specs;
}

module.exports = { tasksForHearingUpdate, shiftDateString, FOLLOW_UP_LEAD_DAYS };
