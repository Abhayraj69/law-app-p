-- ═════════════════════════════════════════════════════════════════════
-- 0024: Matter-wide analysis (Phase 3 — Chronology, Issue Matrix, Remedy
-- Outline)
--
-- Extends the AI Copilot from single-document summaries (summarizeDocument
-- in copilotController.js) to matter-wide analysis: a chronology built
-- from every document/hearing attached to a case, an issue matrix of the
-- distinct legal issues those documents raise, and a remedy outline built
-- from the two. See docs/ROADMAP_PHASE_3_TO_6.pdf for the original scope.
--
-- One table, one row per generation, rather than an upsert-in-place row
-- per (case, type):
--
-- 1. A generation is expensive (reads every document in the matter through
--    the AI provider) and its output is exactly the kind of thing a
--    partner may want to compare across time as new documents are added —
--    keeping history costs one JSONB column's worth of storage and avoids
--    silently discarding a previous read of the matter.
-- 2. "Latest" is just the newest row for a (firm_id, case_id,
--    analysis_type) — no separate is_current flag to keep in sync.
--
-- content is JSONB because the three analysis types have different
-- internal shapes (chronology: a list of dated events; issue matrix: a
-- list of issues cross-referenced to where they appear; remedy outline:
-- a list of drafted sections) and none of them are queried by sub-field —
-- only ever read back whole by case_id + analysis_type, the same way
-- documents.tags or hearings' free-text fields already are.
--
-- source_count is denormalized (not derived from content on every read)
-- purely so the case's analysis tab can show "built from N sources"
-- without deserializing the JSONB, mirroring hearings.risk_flag being
-- readable without inspecting submissions/orders_passed.
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS matter_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    case_id VARCHAR(50) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    analysis_type VARCHAR(20) NOT NULL
        CHECK (analysis_type IN ('chronology', 'issue_matrix', 'remedy_outline')),
    -- Every generated line in `content` carries a `source` (or `sources`)
    -- pointer back to the document_id/hearing_id and date it came from —
    -- the Copilot's existing "never assert something it can't point back
    -- to" principle (see copilotTools.js), extended to matter-wide output.
    content JSONB NOT NULL,
    source_count INTEGER NOT NULL DEFAULT 0,
    generated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_matter_analyses_latest
    ON matter_analyses(firm_id, case_id, analysis_type, created_at DESC);

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'GENERATE_MATTER_ANALYSIS';
