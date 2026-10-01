-- ═════════════════════════════════════════════════════════════════════
-- 0028: Real Postgres full-text search (Phase 6)
--
-- Replaces the global omnibox's in-memory scorer (server/services/
-- searchService.js's old `fieldScore` — a JS substring/prefix check run
-- over every case and document the caller can see, pulled into memory
-- first) with real `tsvector`/`ts_rank` queries run in Postgres, per the
-- roadmap's "Real Postgres full-text search, replacing the current simple
-- keyword scorer."
--
-- Only `cases` gets a matching GIN expression index: the search query
-- there filters directly with `@@` against a fixed expression, so the
-- index is usable by the planner as long as the expression in the query
-- matches this one exactly (a requirement for Postgres expression
-- indexes). Documents are NOT indexed the same way — that search also
-- needs each document's case name and comma-joined tags, both of which
-- only exist after DOCUMENT_SELECT's own JOIN/GROUP BY aggregation (see
-- server/db.js), so its tsvector is necessarily built in an outer query
-- over that already-aggregated result rather than a plain per-row
-- expression on `documents` — there's nothing for a per-table index to
-- attach to. This is an accepted, deliberate limit, not an oversight:
-- documents also still have no persisted extracted/OCR text column (see
-- server/services/documentTextExtractor.js's on-the-fly extraction), so
-- full-text search here still means "over filename/case/tags metadata,"
-- not document contents — extending it to contents would mean persisting
-- extracted text at upload time, a larger change than this phase's scope.
-- ═════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_cases_fulltext ON cases USING GIN (
    to_tsvector('english',
        coalesce(case_name, '') || ' ' || coalesce(client_name, '') || ' ' ||
        coalesce(opposing_party, '') || ' ' || coalesce(opposing_counsel, '') || ' ' ||
        coalesce(case_type, '') || ' ' || id
    )
);
