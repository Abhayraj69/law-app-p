const SearchService = require('../services/searchService');

/**
 * Search Controller
 * GET /api/v1/search?q=...&limit=... — see server/services/searchService.js
 * for the role/ownership scoping and ranking rules.
 */
async function search(req, res, next) {
  try {
    const { q = '', limit } = req.query;
    const data = await SearchService.search(req.tenantId, req.user, q, limit);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { search };
