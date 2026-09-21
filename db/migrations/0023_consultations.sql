-- ═════════════════════════════════════════════════════════════════════
-- 0023: Consultation intake + document bundling
--
-- Phase 2 of the practice-management roadmap. Every entity this app has
-- had until now (cases, case_intake, hearings, tasks) begins its life
-- already AS a case — even case_intake (0015), which gates a case's
-- promotion to 'active', still mints a real `cases.id` row up front via
-- MatterIntakeService.startIntake. `consultations` is the first entity in
-- this schema that exists BEFORE any case does: a staff-assisted record of
-- a prospective client's initial screening, which may or may not ever
-- become a real matter.
--
-- Design choices:
--
-- 1. firm_id leads the table (tenant scoping), same as everywhere else.
--    There is deliberately no client_user_id / case_id at creation time —
--    a consultation predates both. Once (if) it converts to a real case,
--    converted_case_id records that outcome; nothing here is retrofitted
--    onto the cases table itself.
--
-- 2. matter_category is a free-text VARCHAR, not a DB enum, validated at
--    the application layer against server/constants/matterCategories.js
--    — same posture cases.case_type already has (VARCHAR + app validation
--    via zod at the Copilot boundary), so a new category can be added by
--    editing one JS file instead of an ALTER TYPE migration. See that
--    file's own header for why the taxonomy isn't retrofitted onto
--    cases.case_type instead.
--
-- 3. status is a real enum (draft -> pending_approval -> approved ->
--    converted). There is deliberately NO 'declined' terminal state: a
--    lawyer declining a submitted consultation note (ConsultationService.
--    declineConsultation) moves it back to 'draft' with last_decline_reason
--    recorded, not into a dead end — the roadmap's "lawyer approval
--    screen" is a revise-and-resubmit loop (mirrors the Copilot's
--    propose/approve shape: a rejection is something staff can act on and
--    resubmit, not a final verdict), not a one-shot reject.
--
-- 4. bundle_document_id points at a real documents row — the merged PDF
--    bundle produced by server/services/pdfTools.js (Phase 0) from every
--    document attached via consultation_documents. It is regenerated (not
--    accumulated) each time ConsultationService.bundleDocuments runs, so
--    this column always names the CURRENT bundle, not a history of them.
--
-- 5. consultation_documents is a linking table rather than a
--    consultation_id column on `documents` itself — same shape decision
--    0015's case_intake made (a separate table, not new cases columns) —
--    because a consultation's uploaded documents start with case_id NULL
--    (documents.case_id is already nullable) and only gain a real case_id
--    once/if the consultation converts, at which point every linked
--    document (bundle included) is re-pointed at the new case in one
--    UPDATE rather than needing its own migration path.
-- ═════════════════════════════════════════════════════════════════════

CREATE TYPE consultation_status AS ENUM ('draft', 'pending_approval', 'approved', 'converted');

CREATE TABLE IF NOT EXISTS consultations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    client_contact VARCHAR(255),
    matter_category VARCHAR(100),
    opposing_party VARCHAR(255),
    opposing_counsel VARCHAR(255),
    referral_source VARCHAR(255),
    -- The "consultation note" the roadmap says needs a lawyer approval
    -- screen before it's finalized.
    intake_notes TEXT,
    status consultation_status NOT NULL DEFAULT 'draft',
    -- An early, non-blocking conflict-check signal (ConflictCheckService.
    -- checkConflicts run against client_name/opposing_party/
    -- opposing_counsel at creation) — informational only here. The
    -- authoritative, BLOCKING conflict check still runs again inside
    -- CaseService.createCase at actual conversion time; running it here
    -- too is deliberately redundant, so staff get an early warning before
    -- investing further in a consultation that will hit a conflict hold
    -- at conversion anyway.
    conflict_flag BOOLEAN NOT NULL DEFAULT FALSE,
    conflict_details JSONB,
    bundle_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    last_decline_reason TEXT,
    converted_case_id VARCHAR(50) REFERENCES cases(id) ON DELETE SET NULL,
    converted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consultations_firm_status ON consultations(firm_id, status);

CREATE TABLE IF NOT EXISTS consultation_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(consultation_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_consultation_documents_consultation ON consultation_documents(consultation_id);

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CREATE_CONSULTATION';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPDATE_CONSULTATION';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPLOAD_CONSULTATION_DOCUMENT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'BUNDLE_CONSULTATION_DOCUMENTS';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'SUBMIT_CONSULTATION';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'APPROVE_CONSULTATION';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'DECLINE_CONSULTATION';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CONVERT_CONSULTATION';
