const InvoiceService = require('../services/invoiceService');

/**
 * Invoice Controller
 * Maps HTTP request handlers to InvoiceService. See
 * server/services/invoiceService.js for the role-scoping rules applied.
 */

async function listInvoices(req, res, next) {
  try {
    const invoices = await InvoiceService.listInvoices(req.tenantId, req.user);
    res.json({ success: true, data: invoices });
  } catch (err) {
    next(err);
  }
}

module.exports = { listInvoices };
