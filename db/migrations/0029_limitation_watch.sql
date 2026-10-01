-- ═════════════════════════════════════════════════════════════════════
-- 0029: Limitation watch engine (Phase 6)
--
-- Tracks statute-of-limitations deadlines per case with a proactive risk
-- flag — "extending the risk_flag field Phase 1's hearings table already
-- has" per the roadmap. Extending it means reusing its exact
-- none/watch/urgent vocabulary and VARCHAR+CHECK convention
-- (0022_hearings_and_tasks.sql), not literally adding a column to
-- `hearings` — a limitation deadline is its own tracked fact, independent
-- of any particular hearing, so it gets its own table.
--
-- risk_flag is NOT a stored column here, unlike hearings.risk_flag (which
-- an associate sets by hand after an appearance). A limitation deadline's
-- urgency is entirely a function of today's date vs. limitation_date, so
-- storing it would mean it goes stale the moment nobody happens to touch
-- the row — this app has no background job runner to refresh it (see
-- reminderEngine.js's own note on why). server/services/
-- limitationWatchEngine.js computes it fresh on every read instead, the
-- same "computed, not stored" convention TaskService.toTaskView's
-- `overdue` and CourtSyncService's `on_upcoming_cause_list` already use.
--
-- status distinguishes a deadline that's still live ('open') from one
-- staff have closed out ('resolved') — a resolved deadline always reads
-- back as risk_flag 'none' regardless of the date, since the thing being
-- watched for no longer needs watching.
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS limitation_deadlines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    case_id VARCHAR(50) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    description VARCHAR(255) NOT NULL,
    limitation_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved')),
    resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_note TEXT,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_limitation_deadlines_firm_case ON limitation_deadlines(firm_id, case_id);
CREATE INDEX IF NOT EXISTS idx_limitation_deadlines_firm_status ON limitation_deadlines(firm_id, status, limitation_date);

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CREATE_LIMITATION_DEADLINE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPDATE_LIMITATION_DEADLINE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'RESOLVE_LIMITATION_DEADLINE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'DELETE_LIMITATION_DEADLINE';
