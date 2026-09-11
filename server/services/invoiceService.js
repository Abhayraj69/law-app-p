const db = require('../db');

/**
 * Invoice Service
 * Backs the client portal's billing view. Role scoping mirrors
 * CaseService/CommunicationsService: db.listInvoicesForUser applies the
 * client_user_id filter (via the invoice's case) for CLIENT callers, and
 * this service never re-derives that filter itself.
 */

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

class InvoiceService {
  /** GET /api/v1/invoices — role-scoped invoice list. */
  static async listInvoices(tenantId, user) {
    const rows = await db.listInvoicesForUser(tenantId, user);
    return rows.map(toInvoiceView);
  }
}

module.exports = InvoiceService;
