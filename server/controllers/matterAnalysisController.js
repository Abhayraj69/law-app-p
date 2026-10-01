const MatterAnalysisService = require('../services/matterAnalysisService');

/**
 * Matter Analysis Controller (Phase 3)
 * Ownership/validation/AI orchestration all live in MatterAnalysisService —
 * see its header comment. Role floors are applied at the route level
 * (server/routes/api.js), same convention as hearings/tasks.
 */

async function getOverview(req, res, next) {
  try {
    const overview = await MatterAnalysisService.getOverview(req.tenantId, req.params.id, req.user);
    res.json({ success: true, data: overview });
  } catch (err) {
    next(err);
  }
}

async function getLatest(req, res, next) {
  try {
    const analysis = await MatterAnalysisService.getLatest(req.tenantId, req.params.id, req.params.type, req.user);
    res.json({ success: true, data: analysis });
  } catch (err) {
    next(err);
  }
}

async function generate(req, res, next) {
  try {
    const analysis = await MatterAnalysisService.generate(
      req.tenantId, req.user, req.params.id, req.params.type, req.log
    );
    res.status(201).json({ success: true, data: analysis });
  } catch (err) {
    next(err);
  }
}

module.exports = { getOverview, getLatest, generate };
