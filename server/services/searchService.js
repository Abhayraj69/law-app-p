const db = require('../db');

/**
 * Search Service
 * Backs the global omnibox search (GET /api/v1/search).
 *
 * Phase 6: ranking now runs in Postgres via `tsvector`/`ts_rank`
 * (db.searchCasesFullText / db.searchDocumentsFullText / db.searchClientsByName
 * — see server/db.js and db/migrations/0028_fulltext_search.sql), replacing
 * the old in-memory JS scorer that pulled every case/document a caller
 * could see into memory and substring-matched them by hand.
 *
 * Role/ownership scoping is unchanged: each db function applies the same
 * scopeCasesToUser/scopeDocumentsToUser rule the Active Cases and Document
 * Vault pages use, so a CLIENT-role caller still never sees another
 * client's case, document, or name here.
 */

const CASE_STATUS_LABELS = { active: 'Active', pending: 'Pending', urgent: 'Urgent', closed: 'Closed' };

class SearchService {
  static async search(tenantId, user, rawQuery, limit = 8) {
    const q = (rawQuery || '').toString().trim();
    if (!q) return { results: [], total: 0, query: rawQuery ? String(rawQuery) : '' };
    const cappedLimit = Math.min(Math.max(Number(limit) || 8, 1), 25);

    // Over-fetch per type before merging so a case/document match doesn't
    // starve out client matches purely because it sorted first within its
    // own type — final ranking/truncation happens once, below.
    const perTypeLimit = cappedLimit;

    const [cases, clients, documents] = await Promise.all([
      db.searchCasesFullText(tenantId, user, q, perTypeLimit),
      db.searchClientsByName(tenantId, user, q, perTypeLimit),
      db.searchDocumentsFullText(tenantId, user, q, perTypeLimit)
    ]);

    const scored = [];

    for (const c of cases) {
      scored.push({
        score: Number(c.rank) || 0,
        result: {
          type: 'case',
          id: c.id,
          name: c.case_name,
          meta: `${CASE_STATUS_LABELS[c.status] || c.status} · ${c.case_type || 'Case'}`
        }
      });
    }

    for (const cl of clients) {
      scored.push({
        // Synthetic entity, no real tsvector rank (see db.searchClientsByName)
        // — ranked just above a typical case/document match, same relative
        // position the old scorer's *2 client boost gave it.
        score: 2,
        result: {
          type: 'client',
          id: cl.client_name,
          name: cl.client_name,
          meta: `Client · ${cl.case_count} case${Number(cl.case_count) === 1 ? '' : 's'}`
        }
      });
    }

    for (const d of documents) {
      scored.push({
        score: Number(d.rank) || 0,
        result: {
          type: 'document',
          id: d.id,
          name: d.file_name,
          meta: d.case_name ? `Document · ${d.case_name}` : 'Document'
        }
      });
    }

    // Stable sort by score desc — Array#sort is stable in Node, so ties
    // keep the cases-then-clients-then-documents order they were pushed in.
    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, cappedLimit).map(s => s.result);
    return { results, total: scored.length, query: q };
  }
}

module.exports = SearchService;
