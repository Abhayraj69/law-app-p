const DashboardService = require('../services/dashboardService');

/**
 * Dashboard Controller
 * GET /api/v1/dashboard/summary — the single aggregating endpoint behind
 * the Dashboard Overview page (KPIs, billing chart, hearings, messages,
 * activity feed) so the client makes one request instead of many.
 */
async function getSummary(req, res, next) {
  try {
    const summary = await DashboardService.getSummary(req.tenantId, req.user);
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSummary };
