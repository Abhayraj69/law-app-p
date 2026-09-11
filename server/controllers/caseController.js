const CaseService = require('../services/caseService');

/**
 * Case Controller
 * Maps HTTP request handlers to CaseService. See server/services/caseService.js
 * for the role-scoping rules applied to every read.
 */

async function listCases(req, res, next) {
  try {
    const cases = await CaseService.listCases(req.tenantId, req.user);
    res.json({ success: true, data: cases });
  } catch (err) {
    next(err);
  }
}

async function getCase(req, res, next) {
  try {
    const found = await CaseService.getCase(req.tenantId, req.params.id, req.user);
    res.json({ success: true, data: found });
  } catch (err) {
    next(err);
  }
}

async function createCase(req, res, next) {
  try {
    const created = await CaseService.createCase(req.tenantId, req.user, req.body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

async function archiveCase(req, res, next) {
  try {
    const updated = await CaseService.archiveCase(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { listCases, getCase, createCase, archiveCase };
