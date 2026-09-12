const db = require('../db');
const CaseService = require('./caseService');

/**
 * Search Service
 * Backs the global omnibox search (GET /api/v1/search). Replaces the
 * hardcoded SEARCH_DATA array that used to live in app.js — see
 * README.md for the real-vs-mock history.
 *
 * Role/ownership scoping: cases and documents both come from the same
 * already-role-scoped reads the Active Cases and Document Vault pages
 * use — CaseService.listCases (-> db.listCasesForUser) and
 * db.listActiveDocuments — rather than a separate unscoped query. Both
 * restrict a CLIENT-role caller to rows tied to their own
 * client_user_id (see scopeCasesToUser/scopeDocumentsToUser in
 * server/db.js), so this service never has to re-derive that rule
 * itself, and can't get it wrong independently. "Client" results are
 * derived from that same role-scoped case list (cases.client_name), so a
 * CLIENT caller never sees another client's name here either.
 *
 * Ranking is deliberately simple, per scope: a case-insensitive
 * substring match (ILIKE-equivalent) against a few relevant fields per
 * record type, with a small bonus when the match is a prefix of the
 * primary display name. No search index or external search service.
 */

const CASE_STATUS_LABELS = { active: 'Active', pending: 'Pending', urgent: 'Urgent', closed: 'Closed' };

// Prefix match ranks above a mid-string match; no match is 0 and filtered
// out entirely. Simple on purpose — see the file header.
function fieldScore(text, needle) {
  if (!text) return 0;
  const t = String(text).toLowerCase();
  if (!t.includes(needle)) return 0;
  return t.startsWith(needle) ? 2 : 1;
}

class SearchService {
  static async search(tenantId, user, rawQuery, limit = 8) {
    const q = (rawQuery || '').toString().trim();
    if (!q) return { results: [], total: 0, query: rawQuery ? String(rawQuery) : '' };
    const needle = q.toLowerCase();
    const cappedLimit = Math.min(Math.max(Number(limit) || 8, 1), 25);

    const [cases, documents] = await Promise.all([
      CaseService.listCases(tenantId, user),
      db.listActiveDocuments(tenantId, user)
    ]);

    const scored = [];

    for (const c of cases) {
      const score = Math.max(
        fieldScore(c.name, needle) * 2, // the case name is what a user is usually looking for
        fieldScore(c.id, needle),
        fieldScore(c.client, needle),
        fieldScore(c.opposingParty, needle),
        fieldScore(c.type, needle)
      );
      if (score > 0) {
        scored.push({
          score,
          result: {
            type: 'case',
            id: c.id,
            name: c.name,
            meta: `${CASE_STATUS_LABELS[c.status] || c.status} · ${c.type || 'Case'}`
          }
        });
      }
    }

    // One result per distinct client name, counted against the same
    // role-scoped case list above (never a separate/unscoped client read).
    const clientCaseCounts = new Map();
    for (const c of cases) {
      if (!c.client) continue;
      clientCaseCounts.set(c.client, (clientCaseCounts.get(c.client) || 0) + 1);
    }
    for (const [clientName, caseCount] of clientCaseCounts) {
      const score = fieldScore(clientName, needle) * 2;
      if (score > 0) {
        scored.push({
          score,
          result: {
            type: 'client',
            id: clientName,
            name: clientName,
            meta: `Client · ${caseCount} case${caseCount === 1 ? '' : 's'}`
          }
        });
      }
    }

    for (const d of documents) {
      const score = Math.max(
        fieldScore(d.file_name, needle) * 2,
        fieldScore(d.case_name, needle),
        ...(d.tags || []).map(t => fieldScore(t, needle))
      );
      if (score > 0) {
        scored.push({
          score,
          result: {
            type: 'document',
            id: d.id,
            name: d.file_name,
            meta: d.case_name ? `Document · ${d.case_name}` : 'Document'
          }
        });
      }
    }

    // Stable sort by score desc — Array#sort is stable in Node, so ties
    // keep the cases-then-clients-then-documents order they were pushed in.
    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, cappedLimit).map(s => s.result);
    return { results, total: scored.length, query: q };
  }
}

module.exports = SearchService;
