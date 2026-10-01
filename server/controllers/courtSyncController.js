const CourtSyncService = require('../services/courtSyncService');

/**
 * Court Sync Controller (Phase 5)
 * Ownership/validation/provider orchestration all live in CourtSyncService
 * — see its header comment. Role floors are applied at the route level
 * (server/routes/api.js), same convention as hearings/tasks/drafts.
 */

async function getCourtSyncState(req, res, next) {
  try {
    const state = await CourtSyncService.getCourtSyncState(req.tenantId, req.params.id, req.user);
    res.json({ success: true, data: state });
  } catch (err) {
    next(err);
  }
}

async function listSyncLogs(req, res, next) {
  try {
    const logs = await CourtSyncService.listSyncLogs(req.tenantId, req.params.id, req.user);
    res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
}

async function listCauseListWatch(req, res, next) {
  try {
    const watchlist = await CourtSyncService.listCauseListWatch(req.tenantId);
    res.json({ success: true, data: watchlist });
  } catch (err) {
    next(err);
  }
}

async function linkCase(req, res, next) {
  try {
    const state = await CourtSyncService.linkCase(req.tenantId, req.user, req.params.id, req.body || {});
    res.json({ success: true, data: state });
  } catch (err) {
    next(err);
  }
}

async function syncCase(req, res, next) {
  try {
    const state = await CourtSyncService.syncCase(req.tenantId, req.user, req.params.id, req.log);
    res.json({ success: true, data: state });
  } catch (err) {
    next(err);
  }
}

async function overrideSync(req, res, next) {
  try {
    const state = await CourtSyncService.overrideSync(req.tenantId, req.user, req.params.id, req.body || {});
    res.status(201).json({ success: true, data: state });
  } catch (err) {
    next(err);
  }
}

async function clearOverride(req, res, next) {
  try {
    const state = await CourtSyncService.clearOverride(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: state });
  } catch (err) {
    next(err);
  }
}

async function setCauseListWatch(req, res, next) {
  try {
    const state = await CourtSyncService.setCauseListWatch(req.tenantId, req.user, req.params.id, req.body?.watch);
    res.json({ success: true, data: state });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCourtSyncState, listSyncLogs, listCauseListWatch,
  linkCase, syncCase, overrideSync, clearOverride, setCauseListWatch
};
