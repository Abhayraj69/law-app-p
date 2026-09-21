const db = require('../db');
const TaskService = require('./taskService');
const { tasksForHearingUpdate } = require('./reminderEngine');

/**
 * Hearing Service
 *
 * Backs the hearing log: scheduling a court appearance, and the
 * associate-facing structured update logged after it (what was submitted,
 * what order was passed, the next date, a risk flag, a suggested draft).
 * See db/migrations/0022_hearings_and_tasks.sql for why this is a separate
 * table from case_deadlines rather than a migration of it.
 *
 * Ownership: a hearing has no per-client column of its own (same as
 * case_deadlines) — every read/write that isn't already scoped to a known
 * case goes through db.getCaseByIdForUser first, so a CLIENT gets the same
 * 404-not-403 "case not found" treatment CaseService's own sub-resource
 * methods use, and staff callers see the case regardless of who's assigned
 * to it (route-level requireRole does the staff-vs-client gating).
 */

const VALID_RISK_FLAGS = ['none', 'watch', 'urgent'];
const VALID_STATUSES = ['scheduled', 'held', 'adjourned', 'disposed'];

function notFound() {
  const err = new Error('Hearing not found.');
  err.status = 404;
  return err;
}

function caseNotFound() {
  const err = new Error('Case not found.');
  err.status = 404;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function toHearingView(row) {
  return {
    id: row.id,
    case_id: row.case_id,
    case_name: row.case_name,
    hearing_date: row.hearing_date,
    court_hall: row.court_hall,
    purpose: row.purpose,
    submissions: row.submissions,
    orders_passed: row.orders_passed,
    next_hearing_date: row.next_hearing_date,
    risk_flag: row.risk_flag,
    suggested_draft: row.suggested_draft,
    status: row.status,
    updated_by_user_id: row.updated_by_user_id,
    updated_by_name: row.updated_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function validateRiskFlag(riskFlag) {
  if (riskFlag !== undefined && !VALID_RISK_FLAGS.includes(riskFlag)) {
    throw badRequest(`risk_flag must be one of: ${VALID_RISK_FLAGS.join(', ')}.`);
  }
  return riskFlag;
}

function validateStatus(status) {
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    throw badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}.`);
  }
  return status;
}

async function assertCaseVisible(tenantId, caseId, user) {
  const caseRow = await db.getCaseByIdForUser(tenantId, caseId, user);
  if (!caseRow) throw caseNotFound();
  return caseRow;
}

class HearingService {
  /** GET /api/v1/hearings — firm-wide staff read, optionally filtered. */
  static async listHearings(tenantId, filters = {}) {
    const { case_id, status, from_date, to_date } = filters;
    validateStatus(status);
    const rows = await db.listHearingsForFirm(tenantId, {
      caseId: case_id, status, fromDate: from_date, toDate: to_date
    });
    return rows.map(toHearingView);
  }

  /** GET /api/v1/cases/:id/hearings — ownership-checked, for the client portal too. */
  static async listHearingsForCase(tenantId, caseId, user) {
    await assertCaseVisible(tenantId, caseId, user);
    const rows = await db.listHearingsForFirm(tenantId, { caseId });
    return rows.map(toHearingView);
  }

  /** POST /api/v1/hearings — schedules a future appearance. */
  static async createHearing(tenantId, actingUser, payload = {}) {
    const { case_id, hearing_date, court_hall, purpose } = payload;
    if (!case_id) throw badRequest('case_id is required.');
    if (!hearing_date) throw badRequest('hearing_date is required.');
    await assertCaseVisible(tenantId, case_id, actingUser);

    const row = await db.insertHearing({
      firmId: tenantId, caseId: case_id, hearingDate: hearing_date,
      courtHall: court_hall || null, purpose: purpose || null
    });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'CREATE_HEARING',
      details: { hearing_id: row.id, case_id, hearing_date }
    });

    return toHearingView(row);
  }

  /**
   * PATCH /api/v1/hearings/:id/log — the associate-facing structured
   * update: what was submitted, what order was passed, the next date, a
   * risk flag, and an optional suggested draft. This is the ONE call site
   * that runs the reminder engine (server/services/reminderEngine.js) —
   * scheduling a hearing (createHearing above) or a plain metadata edit
   * never generates tasks, only a real logged update does, since only a
   * logged update carries the fields (next_hearing_date, suggested_draft)
   * the rules actually key off.
   */
  static async logHearingUpdate(tenantId, actingUser, hearingId, payload = {}) {
    const existing = await db.getHearingById(tenantId, hearingId);
    if (!existing) throw notFound();

    validateRiskFlag(payload.risk_flag);
    validateStatus(payload.status);

    const updates = { updatedByUserId: actingUser.id };
    if (payload.submissions !== undefined) updates.submissions = payload.submissions;
    if (payload.orders_passed !== undefined) updates.ordersPassed = payload.orders_passed;
    if (payload.next_hearing_date !== undefined) updates.nextHearingDate = payload.next_hearing_date || null;
    if (payload.risk_flag !== undefined) updates.riskFlag = payload.risk_flag;
    if (payload.suggested_draft !== undefined) updates.suggestedDraft = payload.suggested_draft || null;
    // A structured update with no explicit status defaults to 'held' — the
    // whole point of this endpoint is recording that the appearance
    // happened; leaving it 'scheduled' would keep tripping the dashboard's
    // "non-updated after hearing" count even though it plainly was.
    updates.status = payload.status !== undefined ? payload.status : 'held';

    const row = await db.updateHearingFields(tenantId, hearingId, updates);

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'UPDATE_HEARING',
      details: { hearing_id: hearingId, status: row.status, risk_flag: row.risk_flag }
    });

    const taskSpecs = tasksForHearingUpdate(row);
    for (const spec of taskSpecs) {
      await TaskService.createAutoTask(tenantId, spec);
    }

    return toHearingView(row);
  }

  /** PATCH /api/v1/hearings/:id — plain metadata edit (date/court/purpose), no reminder rules run. */
  static async updateHearing(tenantId, actingUser, hearingId, payload = {}) {
    const existing = await db.getHearingById(tenantId, hearingId);
    if (!existing) throw notFound();

    const updates = {};
    if (payload.hearing_date !== undefined) updates.hearingDate = payload.hearing_date;
    if (payload.court_hall !== undefined) updates.courtHall = payload.court_hall;
    if (payload.purpose !== undefined) updates.purpose = payload.purpose;

    const row = await db.updateHearingFields(tenantId, hearingId, updates);

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'UPDATE_HEARING',
      details: { hearing_id: hearingId, updates: payload }
    });

    return toHearingView(row);
  }

  /** DELETE /api/v1/hearings/:id */
  static async deleteHearing(tenantId, actingUser, hearingId) {
    const existing = await db.getHearingById(tenantId, hearingId);
    if (!existing) throw notFound();

    await db.deleteHearingRow(tenantId, hearingId);

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'DELETE_HEARING',
      details: { hearing_id: hearingId, case_id: existing.case_id }
    });

    return { deleted: true };
  }
}

module.exports = HearingService;
