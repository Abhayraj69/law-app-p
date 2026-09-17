const TimeEntryService = require('../services/timeEntryService');

/**
 * Time Entry Controller
 * Ownership/role scoping lives in TimeEntryService, not here — see its
 * own header comment for the exact PARALEGAL-vs-ASSOCIATE+ rules.
 */

async function listTimeEntries(req, res, next) {
  try {
    const { case_id, status, user_id } = req.query;
    const entries = await TimeEntryService.listTimeEntries(req.tenantId, req.user, { case_id, status, user_id });
    res.json({ success: true, data: entries });
  } catch (err) {
    next(err);
  }
}

async function createTimeEntry(req, res, next) {
  try {
    const entry = await TimeEntryService.createTimeEntry(req.tenantId, req.user, req.body || {});
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

async function updateTimeEntry(req, res, next) {
  try {
    const entry = await TimeEntryService.updateTimeEntry(req.tenantId, req.user, req.params.id, req.body || {});
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

async function deleteTimeEntry(req, res, next) {
  try {
    const result = await TimeEntryService.deleteTimeEntry(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function generateInvoiceFromTimeEntries(req, res, next) {
  try {
    const invoice = await TimeEntryService.generateInvoiceFromTimeEntries(req.tenantId, req.user, req.body || {});
    res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    next(err);
  }
}

async function getInvoiceLineItems(req, res, next) {
  try {
    const items = await TimeEntryService.getLineItems(req.tenantId, req.params.id);
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
  generateInvoiceFromTimeEntries,
  getInvoiceLineItems
};
