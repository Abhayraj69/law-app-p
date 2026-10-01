-- ═════════════════════════════════════════════════════════════════════
-- 0025: Drafting automation (Phase 4)
--
-- Turns a 'draft_needed' task (Phase 1's reminder engine, triggered by a
-- hearing's suggested_draft — see 0022's comment on that column) into an
-- actual generated draft, built from Phase 3's chronology/issue matrix
-- rather than raw documents again. See docs/ROADMAP_PHASE_3_TO_6.pdf.
--
-- Design choices:
--
-- 1. One row per generation, same reasoning as matter_analyses (0024):
--    a rejected draft is regenerated, not overwritten in place, so a
--    partner reviewing "what changed since last time" isn't looking at a
--    silently-mutated row. "Latest" is just the newest row for a task.
--
-- 2. template_key is constrained to the RFP's named top 5, not a foreign
--    key into a table — the template library itself
--    (server/services/draftTemplates.js) is static content bundled with
--    the app, not data a firm edits at runtime, so it doesn't need a row
--    to reference.
--
-- 3. status is a real, persisted state machine (pending_review / approved
--    / rejected), not the Copilot's ephemeral propose_change shape —
--    same reasoning 0023's consultations comment gives for why THAT
--    needed a persisted row instead of a chat-only proposal: a generated
--    draft has to survive a page reload and be independently reviewable.
--    A draft is never auto-filed or sent; approval only marks the
--    generating task 'done' (server/services/draftService.js), it never
--    files anything externally — there is nowhere in this app yet that
--    would even mean "filed."
--
-- 4. task_id is nullable and ON DELETE SET NULL, matching tasks.hearing_id
--    in 0022 — a generated draft is a historical fact and must survive
--    its originating task being deleted.
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    case_id VARCHAR(50) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    hearing_id UUID REFERENCES hearings(id) ON DELETE SET NULL,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    template_key VARCHAR(30) NOT NULL
        CHECK (template_key IN ('interlocutory_application', 'adjournment', 'exemption', 'delay_condonation', 'stay')),
    -- Same shape convention as matter_analyses.content: a list of drafted
    -- sections, each source-linked back to the document/hearing/chronology
    -- item it was drawn from (see draftService.js's resolveSource).
    content JSONB NOT NULL,
    source_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending_review'
        CHECK (status IN ('pending_review', 'approved', 'rejected')),
    generated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_drafts_firm_case ON drafts(firm_id, case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_task ON drafts(task_id, created_at DESC) WHERE task_id IS NOT NULL;

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'GENERATE_DRAFT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'APPROVE_DRAFT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'REJECT_DRAFT';
