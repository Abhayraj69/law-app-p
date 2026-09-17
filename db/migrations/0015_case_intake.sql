-- ═════════════════════════════════════════════════════════════════════
-- 0015: Matter-opening workflow (conflict check -> engagement letter ->
-- signed -> retainer received -> activated)
--
-- A case has always gone straight from "created" to status='active' (see
-- CaseService.createCase) with nothing in between but a one-shot conflict
-- check the SAME request could immediately override. This adds a
-- deliberately separate `case_intake` table (not new columns on `cases`)
-- so the workflow is structurally optional and removable — a case with no
-- case_intake row is simply grandfathered as already active, exactly like
-- every case created before this migration. Only cases opened through the
-- new "Start Matter Intake" flow (see server/services/matterIntakeService.js)
-- get a row here and are gated by it.
--
-- case_intake_events is an append-only transition log, same posture as
-- trust_transactions (0014) — a correction is a new event, never an
-- edited or deleted one.
-- ═════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CASE_INTAKE_STARTED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CASE_INTAKE_CONFLICT_HOLD';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CASE_INTAKE_CONFLICT_OVERRIDE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CASE_INTAKE_ENGAGEMENT_LETTER_UPLOADED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CASE_INTAKE_ENGAGEMENT_LETTER_SENT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CASE_INTAKE_SIGNED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CASE_INTAKE_RETAINER_LINKED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CASE_INTAKE_RETAINER_WAIVED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CASE_ACTIVATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CASE_INTAKE_DECLINED';

CREATE TYPE case_intake_state AS ENUM (
    'CONFLICT_PENDING', 'CONFLICT_HOLD', 'CONFLICT_CLEARED',
    'ENGAGEMENT_LETTER_DRAFTED', 'ENGAGEMENT_LETTER_SENT', 'SIGNED',
    'RETAINER_RECEIVED', 'ACTIVATED', 'DECLINED'
);

CREATE TABLE IF NOT EXISTS case_intake (
    case_id VARCHAR(50) PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    state case_intake_state NOT NULL DEFAULT 'CONFLICT_PENDING',
    conflict_check_matches JSONB,
    conflict_override_by UUID REFERENCES users(id),
    conflict_override_reason TEXT,
    engagement_letter_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    engagement_letter_sent_at TIMESTAMP WITH TIME ZONE,
    -- The countersigned copy. Populated either by a staff member manually
    -- uploading the countersigned document (exactly like
    -- engagement_letter_document_id) or, as of migration 0019, by a
    -- completed e-signature request tied to this case — deliberately just
    -- a document id + timestamp, written the same way by both paths, so
    -- migration 0019 needed no schema change here to add the second one.
    signed_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    signed_at TIMESTAMP WITH TIME ZONE,
    -- Reuses the trust ledger (0014) directly — "retainer received" is
    -- proven by a real trust_transactions row, not a checkbox.
    retainer_transaction_id UUID REFERENCES trust_transactions(id),
    retainer_waived BOOLEAN NOT NULL DEFAULT FALSE,
    retainer_waived_reason TEXT,
    activated_at TIMESTAMP WITH TIME ZONE,
    activated_by UUID REFERENCES users(id),
    declined_at TIMESTAMP WITH TIME ZONE,
    declined_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_case_intake_firm ON case_intake(firm_id, state);

CREATE TABLE IF NOT EXISTS case_intake_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id VARCHAR(50) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    from_state case_intake_state,
    to_state case_intake_state NOT NULL,
    actor_id UUID REFERENCES users(id),
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_case_intake_events_case ON case_intake_events(case_id, created_at);
