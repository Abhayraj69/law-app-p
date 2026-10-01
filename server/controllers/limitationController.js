const LimitationService = require('../services/limitationService');

/**
 * Limitation Controller (Phase 6)
 * Validation/ownership all live in LimitationService — see its header
 * comment. Role floors are applied at the route level (server/routes/api.js).
 */

async function listDeadlines(req, res, next) {
  try {
    const deadlines = await LimitationService.listDeadlines(req.tenantId, req.query || {});
    res.json({ success: true, data: deadlines });
  } catch (err) {
    next(err);
  }
}

async function listDeadlinesForCase(req, res, next) {
  try {
    const deadlines = await LimitationService.listDeadlinesForCase(req.tenantId, req.params.id, req.user);
    res.json({ success: true, data: deadlines });
  } catch (err) {
    next(err);
  }
}

async function createDeadline(req, res, next) {
  try {
    const deadline = await LimitationService.createDeadline(req.tenantId, req.user, req.body || {});
    res.status(201).json({ success: true, data: deadline });
  } catch (err) {
    next(err);
  }
}

async function updateDeadline(req, res, next) {
  try {
    const deadline = await LimitationService.updateDeadline(req.tenantId, req.user, req.params.id, req.body || {});
    res.json({ success: true, data: deadline });
  } catch (err) {
    next(err);
  }
}

async function resolveDeadline(req, res, next) {
  try {
    const deadline = await LimitationService.resolveDeadline(req.tenantId, req.user, req.params.id, req.body?.note);
    res.json({ success: true, data: deadline });
  } catch (err) {
    next(err);
  }
}

async function deleteDeadline(req, res, next) {
  try {
    const result = await LimitationService.deleteDeadline(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { listDeadlines, listDeadlinesForCase, createDeadline, updateDeadline, resolveDeadline, deleteDeadline };
