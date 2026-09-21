-- ═════════════════════════════════════════════════════════════════════
-- 0022: Hearing log + task/reminder foundation
--
-- Phase 1 of the practice-management roadmap. Two tables:
--
--   hearings — a real record of what happened at each court appearance
--              (court hall, purpose, what was submitted, what order was
--              passed, the next date the court gave), one row per
--              appearance. case_deadlines (0000 baseline schema) only
--              ever held a single upcoming date per row with no way to
--              record an outcome — this is genuinely a different table,
--              not a migration of that one. case_deadlines is left
--              exactly as it is (still backs the dashboard's "next
--              hearing" widget and the client portal's deadline list);
--              nothing here touches it.
--
--   tasks    — a rules-based reminder's output. A task can be logged by
--              hand or generated automatically by the reminder engine
--              (server/services/reminderEngine.js) when a structured
--              hearing update implies follow-up work — a next date to
--              prepare for, or a suggested draft to produce. "Reminder"
--              here means "a task shows up as due/overdue when read,"
--              not a push notification — there is no background job
--              runner anywhere in this app yet, and email/SMS channels
--              are explicitly a later phase (6), so this stays
--              deliberately in-app-only rather than half-building a
--              notification system this phase doesn't need.
--
-- Design choices, same conventions as every prior migration:
--
-- 1. firm_id leads every table (tenant scoping) and every composite
--    index, same as case_deadlines/time_entries/etc.
--
-- 2. hearings.case_id is NOT NULL — unlike case_deadlines (which also
--    backs firm-wide, non-case-specific reminders), a hearing is always
--    an appearance IN a specific matter. cases.id is VARCHAR(50)
--    (e.g. "LC-2026-001"), not UUID, so the FK type matches that.
--
-- 3. risk_flag ('none'/'watch'/'urgent') exists because the source RFP
--    calls out flagging risk directly from a hearing update, not just
--    recording history — a partner scanning the dashboard should be
--    able to tell "something here needs attention" without reading
--    every submissions/orders_passed field.
--
-- 4. suggested_draft is a free-text hint captured at update time (e.g.
--    "Adjournment Application"), not yet a foreign key into a template
--    table — Phase 4 (drafting automation) is what turns this into a
--    real drafts table + template library. Until then it's what drives
--    the reminder engine's 'draft_needed' task and the dashboard's
--    "awaiting draft" count.
--
-- 5. tasks.hearing_id is nullable and ON DELETE SET NULL: a task that
--    originated from a hearing update should survive if that hearing
--    row is ever deleted (unlikely, but a task shouldn't silently
--    vanish because of it) — same "historical fact should survive"
--    reasoning prior migrations use for ON DELETE SET NULL vs CASCADE.
--    tasks.case_id is nullable (a task isn't always tied to a specific
--    matter) but CASCADEs, matching case_deadlines' own case_id.
--
-- 6. auto_generated distinguishes a reminder-engine task from one a
--    person typed in by hand — surfaced in the UI so nobody mistakes a
--    rule's guess for a human instruction, and lets the reminder engine
--    later find "did I already create this" without a fragile title
--    match (see reminderEngine.js / TaskService.createAutoTask).
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hearings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    case_id VARCHAR(50) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    hearing_date DATE NOT NULL,
    court_hall VARCHAR(100),
    purpose VARCHAR(255),
    submissions TEXT,
    orders_passed TEXT,
    next_hearing_date DATE,
    risk_flag VARCHAR(20) NOT NULL DEFAULT 'none'
        CHECK (risk_flag IN ('none', 'watch', 'urgent')),
    suggested_draft VARCHAR(100),
    -- 'scheduled' until an associate logs the structured update after the
    -- appearance; that update is what moves it to held/adjourned/disposed.
    -- A hearing whose date has passed and is STILL 'scheduled' is exactly
    -- the dashboard's "non-updated after hearing" signal.
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'held', 'adjourned', 'disposed')),
    updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hearings_firm_case ON hearings(firm_id, case_id);
CREATE INDEX IF NOT EXISTS idx_hearings_firm_date ON hearings(firm_id, hearing_date);
CREATE INDEX IF NOT EXISTS idx_hearings_firm_status ON hearings(firm_id, status);

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    case_id VARCHAR(50) REFERENCES cases(id) ON DELETE CASCADE,
    hearing_id UUID REFERENCES hearings(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    task_type VARCHAR(30) NOT NULL DEFAULT 'general'
        CHECK (task_type IN ('general', 'draft_needed', 'follow_up', 'reminder')),
    due_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'done', 'dismissed')),
    assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_firm_status ON tasks(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_firm_due ON tasks(firm_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_firm_case ON tasks(firm_id, case_id);
CREATE INDEX IF NOT EXISTS idx_tasks_hearing ON tasks(hearing_id) WHERE hearing_id IS NOT NULL;

-- New privileged write paths, same reasoning as every prior audit-action
-- addition: each gets its own action rather than folding into a generic
-- 'UPDATE'.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CREATE_HEARING';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPDATE_HEARING';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'DELETE_HEARING';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CREATE_TASK';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPDATE_TASK';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'DELETE_TASK';
