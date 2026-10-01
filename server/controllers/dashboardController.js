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

/**
 * GET /api/v1/analytics/management (Phase 6) — firm-level reporting across
 * cases, billing, and staff workload. PARTNER+ only (see routes/api.js).
 */
async function getManagementAnalytics(req, res, next) {
  try {
    const analytics = await DashboardService.getManagementAnalytics(req.tenantId);
    res.json({ success: true, data: analytics });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSummary, getManagementAnalytics };
