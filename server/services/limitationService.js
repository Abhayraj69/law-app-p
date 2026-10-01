const db = require('../db');
const CaseService = require('./caseService');
const limitationWatchEngine = require('./limitationWatchEngine');

/**
 * Limitation Service — Phase 6 (limitation watch engine)
 *
 * Backs per-case and firm-wide statute-of-limitations tracking. Role floor
 * is PARALEGAL for everything — same "routine own work, visible firm-wide"
 * reasoning TaskService gives for tasks: tracking a deadline and resolving
 * it once it's been met is not a privileged action, and every deadline
 * should be visible to any staff member scanning for risk, not scoped to
 * whoever created it.
 */

function notFound() {
  const err = new Error('Limitation deadline not found.');
  err.status = 404;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function validateDescription(description) {
  if (!description || !String(description).trim()) {
    throw badRequest('description is required.');
  }
  return String(description).trim();
}

function validateLimitationDate(date) {
  if (!date) throw badRequest('limitation_date is required.');
  return date;
}

function toDeadlineView(row) {
  return {
    id: row.id,
    case_id: row.case_id,
    case_name: row.case_name,
    description: row.description,
    limitation_date: row.limitation_date,
    status: row.status,
    // Computed, not stored — see limitationWatchEngine.js.
    risk_flag: limitationWatchEngine.computeRiskFlag(row),
    resolved_by_name: row.resolved_by_name || null,
    resolved_at: row.resolved_at,
    resolution_note: row.resolution_note,
    created_by_name: row.created_by_name || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

class LimitationService {
  /** GET /api/v1/limitation-deadlines — firm-wide, optionally filtered. */
  static async listDeadlines(tenantId, filters = {}) {
    const rows = await db.listLimitationDeadlinesForFirm(tenantId, {
      caseId: filters.case_id, status: filters.status
    });
    return rows.map(toDeadlineView);
  }

  /** GET /api/v1/cases/:id/limitation-deadlines — ownership-checked, for the client portal too. */
  static async listDeadlinesForCase(tenantId, caseId, user) {
    await CaseService.getCase(tenantId, caseId, user); // throws 404 if not visible to this user
    const rows = await db.listLimitationDeadlinesForFirm(tenantId, { caseId });
    return rows.map(toDeadlineView);
  }

  /** POST /api/v1/limitation-deadlines */
  static async createDeadline(tenantId, actingUser, payload = {}) {
    const { case_id, description, limitation_date } = payload;
    if (!case_id) throw badRequest('case_id is required.');
    await CaseService.getCase(tenantId, case_id, actingUser);

    const row = await db.insertLimitationDeadline({
      firmId: tenantId, caseId: case_id,
      description: validateDescription(description),
      limitationDate: validateLimitationDate(limitation_date),
      createdByUserId: actingUser.id
    });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'CREATE_LIMITATION_DEADLINE',
      details: { deadline_id: row.id, case_id, limitation_date: row.limitation_date }
    });

    return toDeadlineView(row);
  }

  /** PATCH /api/v1/limitation-deadlines/:id */
  static async updateDeadline(tenantId, actingUser, deadlineId, payload = {}) {
    const existing = await db.getLimitationDeadlineById(tenantId, deadlineId);
    if (!existing) throw notFound();

    const updates = {};
    if (payload.description !== undefined) updates.description = validateDescription(payload.description);
    if (payload.limitation_date !== undefined) updates.limitationDate = validateLimitationDate(payload.limitation_date);

    const row = await db.updateLimitationDeadlineFields(tenantId, deadlineId, updates);

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'UPDATE_LIMITATION_DEADLINE',
      details: { deadline_id: deadlineId, updates: payload }
    });

    return toDeadlineView(row);
  }

  /**
   * PATCH /api/v1/limitation-deadlines/:id/resolve — the deadline was met
   * (or is otherwise no longer live) in time; reads back as risk_flag
   * 'none' from here on regardless of the date (see toDeadlineView).
   */
  static async resolveDeadline(tenantId, actingUser, deadlineId, note) {
    const existing = await db.getLimitationDeadlineById(tenantId, deadlineId);
    if (!existing) throw notFound();
    if (existing.status === 'resolved') {
      throw badRequest('This deadline is already resolved.', 'ALREADY_RESOLVED');
    }

    const row = await db.updateLimitationDeadlineFields(tenantId, deadlineId, {
      status: 'resolved', resolvedByUserId: actingUser.id, resolvedAt: new Date(),
      resolutionNote: note ? String(note).trim() : null
    });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'RESOLVE_LIMITATION_DEADLINE',
      details: { deadline_id: deadlineId }
    });

    return toDeadlineView(row);
  }

  /** DELETE /api/v1/limitation-deadlines/:id — for a deadline logged by mistake. */
  static async deleteDeadline(tenantId, actingUser, deadlineId) {
    const existing = await db.getLimitationDeadlineById(tenantId, deadlineId);
    if (!existing) throw notFound();

    await db.deleteLimitationDeadlineRow(tenantId, deadlineId);

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'DELETE_LIMITATION_DEADLINE',
      details: { deadline_id: deadlineId, description: existing.description }
    });

    return { deleted: true };
  }
}

module.exports = LimitationService;
