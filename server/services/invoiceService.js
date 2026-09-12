const db = require('../db');

/**
 * Invoice Service
 * Backs both the client portal's read-only billing view and the staff
 * Billing page's create/edit/mark-paid flows. Role scoping mirrors
 * CaseService/CommunicationsService: db.listInvoicesForUser applies the
 * client_user_id filter (via the invoice's case) for CLIENT callers, and
 * this service never re-derives that filter itself. The write methods
 * below are staff-only — enforced by requireRole('ASSOCIATE'+) on the
 * routes in server/routes/api.js, not re-checked here.
 */

const VALID_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'void'];

function notFound() {
  const err = new Error('Invoice not found.');
  err.status = 404;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function toInvoiceView(row) {
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    case_id: row.case_id,
    case_name: row.case_name,
    amount_cents: row.amount_cents,
    status: row.status,
    issued_date: row.issued_date,
    due_date: row.due_date,
    paid_date: row.paid_date
  };
}

function validateAmount(amountCents) {
  if (amountCents === undefined || amountCents === null) {
    throw badRequest('amount_cents is required.');
  }
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw badRequest('amount_cents must be a non-negative integer (money in whole cents).');
  }
  return amountCents;
}

function validateStatus(status, { allowPaid }) {
  if (!VALID_STATUSES.includes(status)) {
    throw badRequest(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}.`);
  }
  if (status === 'paid' && !allowPaid) {
    throw badRequest(`Use the "Mark Paid" action to set an invoice's status to paid — it also records the payment date.`, 'USE_MARK_PAID');
  }
  return status;
}

// `case_id` is optional on an invoice (firm-level fees with no single
// matter), but when given it must be a real case in this firm — checked
// with no `user` argument (unscoped by CLIENT ownership) since invoice
// writes are staff-only.
async function assertCaseInFirm(tenantId, caseId) {
  const caseRow = await db.getCaseByIdForUser(tenantId, caseId, null);
  if (!caseRow) {
    throw badRequest(`No case matches "${caseId}".`, 'CASE_NOT_FOUND');
  }
}

class InvoiceService {
  /** GET /api/v1/invoices — role-scoped invoice list. */
  static async listInvoices(tenantId, user) {
    const rows = await db.listInvoicesForUser(tenantId, user);
    return rows.map(toInvoiceView);
  }

  /**
   * POST /api/v1/invoices — create a new invoice. `invoice_number` is
   * always generated server-side (INV-YYYY-NNN, same convention
   * CaseService.createCase uses for LC-YYYY-NNN case ids) rather than
   * caller-supplied, so it can't collide with or be spoofed against the
   * table's unique (firm_id, invoice_number) constraint. A brand-new
   * invoice can't be created already 'paid' — create as draft/sent and
   * use markInvoicePaid once payment actually arrives, so paid_date is
   * always set by that dedicated path.
   */
  static async createInvoice(tenantId, actingUser, payload = {}) {
    const { case_id, amount_cents, status, issued_date, due_date } = payload;

    const amount = validateAmount(amount_cents);
    const resolvedStatus = status !== undefined && status !== null
      ? validateStatus(status, { allowPaid: false })
      : undefined;

    if (case_id) await assertCaseInFirm(tenantId, case_id);

    const year = new Date().getFullYear();
    const maxNum = await db.getMaxInvoiceNumber(tenantId);
    const invoiceNumber = `INV-${year}-${String(maxNum + 1).padStart(3, '0')}`;

    const row = await db.insertInvoice({
      firmId: tenantId,
      caseId: case_id || null,
      invoiceNumber,
      amountCents: amount,
      status: resolvedStatus,
      issuedDate: issued_date || null,
      dueDate: due_date || null
    });

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser ? actingUser.id : null,
      action: 'CREATE_INVOICE',
      details: { invoice_id: row.id, invoice_number: row.invoice_number, amount_cents: amount }
    });

    return toInvoiceView(row);
  }

  /**
   * PATCH /api/v1/invoices/:id — updates case/amount/due-date/non-paid
   * status. Setting status to 'paid' is rejected here — see
   * markInvoicePaid below, the dedicated action for that transition
   * (mirrors CaseService: archiveCase is a separate action from the
   * generic updateCaseFields, not a status value that update can set).
   */
  static async updateInvoice(tenantId, actingUser, invoiceId, payload = {}) {
    const updates = {};

    if (payload.case_id !== undefined) {
      if (payload.case_id) await assertCaseInFirm(tenantId, payload.case_id);
      updates.caseId = payload.case_id;
    }
    if (payload.amount_cents !== undefined) {
      updates.amountCents = validateAmount(payload.amount_cents);
    }
    if (payload.due_date !== undefined) {
      updates.dueDate = payload.due_date;
    }
    if (payload.status !== undefined) {
      updates.status = validateStatus(payload.status, { allowPaid: false });
    }

    const row = await db.updateInvoiceFields(tenantId, invoiceId, updates);
    if (!row) throw notFound();

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser ? actingUser.id : null,
      action: 'UPDATE_INVOICE',
      details: { invoice_id: invoiceId, updates: payload }
    });

    return toInvoiceView(row);
  }

  /**
   * PATCH /api/v1/invoices/:id/mark-paid — the only path that can ever
   * set status='paid' (see updateInvoice above). `paidDate` is optional
   * and defaults to today at the db layer.
   */
  static async markInvoicePaid(tenantId, actingUser, invoiceId, paidDate) {
    const row = await db.markInvoicePaidRow(tenantId, invoiceId, paidDate || null);
    if (!row) throw notFound();

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser ? actingUser.id : null,
      action: 'MARK_INVOICE_PAID',
      details: { invoice_id: invoiceId, paid_date: row.paid_date }
    });

    return toInvoiceView(row);
  }
}

module.exports = InvoiceService;
