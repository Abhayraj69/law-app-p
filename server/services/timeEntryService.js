const db = require('../db');

/**
 * Time Entry Service
 *
 * Backs time tracking and the "generate invoice from time entries" flow —
 * the piece invoices were missing before: a record of what an invoice's
 * amount is actually FOR. See db/migrations/0021_time_tracking_and_invoice_line_items.sql
 * for the schema design rationale (whole minutes, snapshotted rate_cents,
 * unbilled-is-a-draft/invoiced-is-immutable).
 *
 * Role floor and ownership scoping (enforced here, on top of the route's
 * requireRole('PARALEGAL') floor in server/routes/api.js):
 *   - PARALEGAL may create/list/edit/delete only their OWN time entries.
 *   - ASSOCIATE and above may list every entry in the firm, and may
 *     edit/delete ANY unbilled entry (a supervisory correction — e.g. a
 *     partner fixing a paralegal's mis-logged hours before invoicing),
 *     but may still only CREATE an entry under their own user_id: nobody
 *     logs time on someone else's behalf.
 *   - Generating an invoice from time entries requires ASSOCIATE+, the
 *     same floor POST /api/v1/invoices already uses.
 *   - CLIENT never reaches any of this — every route in api.js sits behind
 *     requireRole('PARALEGAL') at minimum, and CLIENT is below PARALEGAL
 *     in ROLE_HIERARCHY.
 */

const { ROLE_HIERARCHY } = require('../middleware/auth');

function notFound() {
  const err = new Error('Time entry not found.');
  err.status = 404;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function isStaffSupervisor(user) {
  return (ROLE_HIERARCHY[user.role] || 0) >= ROLE_HIERARCHY.ASSOCIATE;
}

function toTimeEntryView(row) {
  return {
    id: row.id,
    case_id: row.case_id,
    case_name: row.case_name,
    user_id: row.user_id,
    user_full_name: row.user_full_name,
    user_initials: row.user_initials,
    entry_date: row.entry_date,
    minutes: row.minutes,
    rate_cents: row.rate_cents,
    // Computed for display convenience — never persisted, so a rate/minutes
    // edit can never leave amount_cents stale on the entry itself (unlike
    // an invoice_line_item, which DOES store its amount, because that one
    // is a historical billing record rather than a live draft).
    amount_cents: Math.round((row.minutes / 60) * row.rate_cents),
    description: row.description,
    billable: row.billable,
    status: row.status,
    invoice_line_item_id: row.invoice_line_item_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function validateMinutes(minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw badRequest('minutes must be a positive whole number.');
  }
  if (minutes > 24 * 60) {
    // Not a hard business rule, just a sanity ceiling against an obvious
    // data-entry error (typing 800 instead of 80, minutes vs hours).
    throw badRequest('A single time entry cannot exceed 24 hours (1440 minutes) — split it into multiple entries.', 'MINUTES_TOO_LARGE');
  }
  return minutes;
}

function validateRate(rateCents) {
  if (!Number.isInteger(rateCents) || rateCents < 0) {
    throw badRequest('rate_cents must be a non-negative integer (money in whole cents).');
  }
  return rateCents;
}

function validateDescription(description) {
  if (!description || !String(description).trim()) {
    throw badRequest('A description of the work performed is required.');
  }
  return String(description).trim();
}

async function assertCaseInFirm(tenantId, caseId) {
  const caseRow = await db.getCaseByIdForUser(tenantId, caseId, null);
  if (!caseRow) {
    throw badRequest(`No case matches "${caseId}".`, 'CASE_NOT_FOUND');
  }
  return caseRow;
}

class TimeEntryService {
  /**
   * GET /api/v1/time-entries — a PARALEGAL sees only their own entries; an
   * ASSOCIATE+ sees the whole firm's (optionally narrowed by the same
   * filters). This distinction is the scoping rule itself, not just a
   * default — it is applied unconditionally regardless of any filter the
   * caller passes, so a PARALEGAL cannot request another user's entries by
   * supplying a `user_id` filter of their own.
   */
  static async listTimeEntries(tenantId, user, filters = {}) {
    const { case_id, status, user_id } = filters;

    if (!isStaffSupervisor(user)) {
      const rows = await db.listTimeEntriesForOwner(tenantId, user.id, { caseId: case_id, status });
      return rows.map(toTimeEntryView);
    }

    const rows = await db.listTimeEntriesForFirm(tenantId, { caseId: case_id, status, userId: user_id });
    return rows.map(toTimeEntryView);
  }

  /**
   * POST /api/v1/time-entries — always logged under the ACTING user's own
   * id; there is no field on this endpoint that lets a caller log time on
   * someone else's behalf, by design (that would let a supervisor pad a
   * subordinate's billable hours without their own name on the entry).
   */
  static async createTimeEntry(tenantId, actingUser, payload = {}) {
    const { case_id, entry_date, minutes, rate_cents, description, billable } = payload;

    if (!case_id) throw badRequest('case_id is required.');
    await assertCaseInFirm(tenantId, case_id);

    const resolvedRate = rate_cents !== undefined && rate_cents !== null
      ? validateRate(rate_cents)
      : actingUser.default_rate_cents;

    if (resolvedRate === undefined || resolvedRate === null) {
      throw badRequest(
        'rate_cents is required — no default billing rate is set for your account.',
        'NO_DEFAULT_RATE'
      );
    }

    const row = await db.insertTimeEntry({
      firmId: tenantId,
      caseId: case_id,
      userId: actingUser.id,
      entryDate: entry_date || null,
      minutes: validateMinutes(minutes),
      rateCents: resolvedRate,
      description: validateDescription(description),
      billable: billable === undefined ? true : !!billable
    });

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser.id,
      action: 'CREATE_TIME_ENTRY',
      details: { time_entry_id: row.id, case_id, minutes: row.minutes }
    });

    return toTimeEntryView(row);
  }

  /**
   * PATCH /api/v1/time-entries/:id — refused once the entry is 'invoiced'
   * (an already-billed hour must not silently change under an invoice
   * that already claims a specific amount for it), and refused for a
   * PARALEGAL trying to edit anyone else's entry.
   */
  static async updateTimeEntry(tenantId, actingUser, entryId, payload = {}) {
    const existing = await db.getTimeEntryById(tenantId, entryId);
    if (!existing) throw notFound();

    if (!isStaffSupervisor(actingUser) && existing.user_id !== actingUser.id) {
      throw forbidden('You may only edit your own time entries.');
    }
    if (existing.status !== 'unbilled') {
      throw badRequest('This time entry has already been invoiced and can no longer be edited.', 'ALREADY_INVOICED');
    }

    const updates = {};
    if (payload.case_id !== undefined) {
      await assertCaseInFirm(tenantId, payload.case_id);
      updates.caseId = payload.case_id;
    }
    if (payload.entry_date !== undefined) updates.entryDate = payload.entry_date;
    if (payload.minutes !== undefined) updates.minutes = validateMinutes(payload.minutes);
    if (payload.rate_cents !== undefined) updates.rateCents = validateRate(payload.rate_cents);
    if (payload.description !== undefined) updates.description = validateDescription(payload.description);
    if (payload.billable !== undefined) updates.billable = !!payload.billable;

    const row = await db.updateTimeEntryFields(tenantId, entryId, updates);

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser.id,
      action: 'UPDATE_TIME_ENTRY',
      details: { time_entry_id: entryId, updates: payload }
    });

    return toTimeEntryView(row);
  }

  /**
   * DELETE /api/v1/time-entries/:id — same ownership and
   * unbilled-only rules as updateTimeEntry.
   */
  static async deleteTimeEntry(tenantId, actingUser, entryId) {
    const existing = await db.getTimeEntryById(tenantId, entryId);
    if (!existing) throw notFound();

    if (!isStaffSupervisor(actingUser) && existing.user_id !== actingUser.id) {
      throw forbidden('You may only delete your own time entries.');
    }
    if (existing.status !== 'unbilled') {
      throw badRequest('This time entry has already been invoiced and can no longer be deleted.', 'ALREADY_INVOICED');
    }

    await db.deleteTimeEntryRow(tenantId, entryId);

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser.id,
      action: 'DELETE_TIME_ENTRY',
      details: { time_entry_id: entryId, case_id: existing.case_id, minutes: existing.minutes }
    });

    return { deleted: true };
  }

  /**
   * POST /api/v1/invoices/from-time-entries — the actual "generate a real
   * invoice from real hours" action. ASSOCIATE+ only, matching the floor
   * on POST /api/v1/invoices.
   *
   * Every named entry must: exist in this firm, belong to the SAME case
   * (an invoice is generated against one matter, not mixed across cases —
   * keeps the line-item breakdown meaningful and matches how invoices
   * already carry a single optional case_id), be billable, and still be
   * 'unbilled'. Any entry failing any of those is a hard refusal of the
   * WHOLE request rather than a partial invoice silently dropping some
   * hours — a partial invoice a biller didn't ask for is worse than an
   * error they have to read.
   */
  static async generateInvoiceFromTimeEntries(tenantId, actingUser, payload = {}) {
    const { case_id, time_entry_ids, issued_date, due_date } = payload;

    if (!case_id) throw badRequest('case_id is required.');
    await assertCaseInFirm(tenantId, case_id);

    if (!Array.isArray(time_entry_ids) || time_entry_ids.length === 0) {
      throw badRequest('time_entry_ids must be a non-empty array.');
    }
    // De-duplicate defensively — a repeated id must not double-bill the
    // same hour onto two line items.
    const uniqueIds = [...new Set(time_entry_ids)];

    const entries = await Promise.all(uniqueIds.map(id => db.getTimeEntryById(tenantId, id)));

    const missing = uniqueIds.filter((id, i) => !entries[i]);
    if (missing.length) {
      throw badRequest(`These time entry ids do not exist in your firm: ${missing.join(', ')}.`, 'ENTRY_NOT_FOUND');
    }

    const wrongCase = entries.filter(e => e.case_id !== case_id);
    if (wrongCase.length) {
      throw badRequest(
        `All time entries must belong to case ${case_id} — ${wrongCase.length} entr${wrongCase.length === 1 ? 'y belongs' : 'ies belong'} to a different case.`,
        'CASE_MISMATCH'
      );
    }

    const notBillable = entries.filter(e => !e.billable);
    if (notBillable.length) {
      throw badRequest('Non-billable time entries cannot be invoiced.', 'NOT_BILLABLE');
    }

    const alreadyBilled = entries.filter(e => e.status !== 'unbilled');
    if (alreadyBilled.length) {
      throw badRequest(
        `${alreadyBilled.length} of these time entries ${alreadyBilled.length === 1 ? 'has' : 'have'} already been invoiced or written off.`,
        'ALREADY_INVOICED'
      );
    }

    const year = new Date().getFullYear();
    const maxNum = await db.getMaxInvoiceNumber(tenantId);
    const invoiceNumber = `INV-${year}-${String(maxNum + 1).padStart(3, '0')}`;

    const invoice = await db.insertInvoiceFromTimeEntries({
      firmId: tenantId,
      caseId: case_id,
      invoiceNumber,
      entries,
      issuedDate: issued_date || null,
      dueDate: due_date || null
    });

    if (!invoice) {
      // A concurrent generation request raced on the same entries between
      // the check above and the transaction — see the WHERE status =
      // 'unbilled' re-check in db.insertInvoiceFromTimeEntries.
      throw badRequest(
        'One or more of these time entries were invoiced by someone else just now. Refresh and try again.',
        'CONCURRENT_INVOICE'
      );
    }

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser.id,
      action: 'GENERATE_INVOICE_FROM_TIME',
      details: {
        invoice_id: invoice.id, invoice_number: invoice.invoice_number,
        case_id, time_entry_ids: uniqueIds, amount_cents: invoice.amount_cents
      }
    });

    return invoice;
  }

  /** GET /api/v1/invoices/:id/line-items */
  static async getLineItems(tenantId, invoiceId) {
    const invoice = await db.getInvoiceById(tenantId, invoiceId);
    if (!invoice) {
      const err = new Error('Invoice not found.');
      err.status = 404;
      throw err;
    }
    return db.getInvoiceLineItems(tenantId, invoiceId);
  }
}

module.exports = TimeEntryService;
