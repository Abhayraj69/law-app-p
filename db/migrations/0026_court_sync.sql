-- ═════════════════════════════════════════════════════════════════════
-- 0026: Court data sync (Phase 5 — Karnataka HC + eCourts)
--
-- Integrates through a licensed third-party legal-data API rather than
-- scraping the public HC/eCourts pages directly (decision recorded in
-- docs/ROADMAP_PHASE_3_TO_6.pdf) via a pluggable adapter
-- (server/services/courtSync/) — same shape server/services/esignature/
-- and server/services/encryption/keyProvider.js already use for their own
-- swappable backends. Only a 'manual' provider ships today (no vendor
-- contract signed yet); a real one is added later as one more file under
-- courtSync/providers/, never a schema or caller change.
--
-- Two things are added:
--
-- 1. Columns directly on `cases`, not a side table — cnr_number/court_name
--    identify the case to the vendor, court_synced_state/court_sync_status
--    hold its CURRENT state, same "per-case single-valued state lives on
--    the case row" convention case_intake.signed_document_id (0015) and
--    hearings.risk_flag (0022) already use. cause_list_watch is a plain
--    boolean, same VARCHAR/BOOLEAN-with-CHECK convention as risk_flag
--    rather than a Postgres ENUM — ENUMs in this codebase are reserved
--    for append-forever value sets like audit_action (see every prior
--    migration's own comment on this).
--
-- 2. court_sync_logs — an append-only attempt history, same posture as
--    signature_request_events (0019): a correction is a new row, never an
--    edited one. triggered_by_user_id is NULL for an automated sync,
--    non-NULL for a staff-initiated "sync now" or manual override —
--    mirrors signature_request_events.actor_id's NULL-means-system
--    convention exactly.
--
-- Manual-override controls: court_sync_status = 'manual_override' is a
-- hold staff can put a case into when the feed is wrong or stale — while
-- set, syncCase() refuses to run rather than silently clobbering the
-- correction (see courtSyncService.js). Clearing the override hands the
-- case back to the normal synced/error flow.
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE cases
    ADD COLUMN IF NOT EXISTS cnr_number VARCHAR(30),
    ADD COLUMN IF NOT EXISTS court_name VARCHAR(150),
    ADD COLUMN IF NOT EXISTS court_synced_state JSONB,
    ADD COLUMN IF NOT EXISTS court_sync_status VARCHAR(20) NOT NULL DEFAULT 'unlinked'
        CHECK (court_sync_status IN ('unlinked', 'synced', 'error', 'manual_override')),
    ADD COLUMN IF NOT EXISTS court_sync_overridden_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS court_sync_overridden_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS court_sync_override_note TEXT,
    ADD COLUMN IF NOT EXISTS cause_list_watch BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_cases_cnr_number ON cases(cnr_number) WHERE cnr_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cases_cause_list_watch ON cases(firm_id, cause_list_watch) WHERE cause_list_watch = TRUE;

CREATE TABLE IF NOT EXISTS court_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    case_id VARCHAR(50) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    provider VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'error', 'manual_override')),
    synced_state JSONB,
    error_message TEXT,
    -- NULL = an automated sync attempt; non-NULL = a staff-initiated
    -- "sync now" or manual override — see signature_request_events.actor_id.
    triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_court_sync_logs_case ON court_sync_logs(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_court_sync_logs_firm ON court_sync_logs(firm_id, created_at DESC);

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'LINK_COURT_CASE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'SYNC_COURT_CASE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'OVERRIDE_COURT_SYNC';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CLEAR_COURT_SYNC_OVERRIDE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPDATE_CAUSE_LIST_WATCH';
