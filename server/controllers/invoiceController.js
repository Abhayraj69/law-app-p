const InvoiceService = require('../services/invoiceService');

/**
 * Invoice Controller
 * Maps HTTP request handlers to InvoiceService. See
 * server/services/invoiceService.js for the role-scoping/validation rules
 * applied. Write routes are additionally gated by requireRole in
 * server/routes/api.js.
 */

async function listInvoices(req, res, next) {
  try {
    const invoices = await InvoiceService.listInvoices(req.tenantId, req.user);
    res.json({ success: true, data: invoices });
  } catch (err) {
    next(err);
  }
}

async function createInvoice(req, res, next) {
  try {
    const created = await InvoiceService.createInvoice(req.tenantId, req.user, req.body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

async function updateInvoice(req, res, next) {
  try {
    const updated = await InvoiceService.updateInvoice(req.tenantId, req.user, req.params.id, req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function markInvoicePaid(req, res, next) {
  try {
    const updated = await InvoiceService.markInvoicePaid(req.tenantId, req.user, req.params.id, req.body?.paid_date);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { listInvoices, createInvoice, updateInvoice, markInvoicePaid };
