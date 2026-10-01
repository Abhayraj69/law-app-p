-- ═════════════════════════════════════════════════════════════════════
-- 0031: Notification channels (Phase 6)
--
-- "Nothing is wired today; Phase 1's tasks and hearings are currently
-- surfaced only in-app... by deliberate scope decision" (roadmap). This
-- adds a real send path through a pluggable adapter
-- (server/services/notifications/) — same shape server/services/
-- esignature/ and server/services/courtSync/ already use — rather than
-- another placeholder.
--
-- Only a 'log' provider ships today: no email/SMS/WhatsApp Business vendor
-- contract exists yet, so it records the attempt (notification_log below)
-- without actually delivering anything, the same "no vendor, no pretend
-- delivery" posture server/services/inviteService.js already documents for
-- invite emails. A real provider (SendGrid, Twilio, WhatsApp Business) is
-- a drop-in file later, never a caller change.
--
-- Deliberately NOT wired as an automatic side effect of task/hearing
-- creation: this app has no background job runner (see reminderEngine.js),
-- and Phase 1's auto-generated tasks are usually unassigned
-- (assigned_to_user_id NULL) until a person picks them up, so there is
-- often no one specific to notify at creation time anyway. Sending stays
-- an explicit, staff-triggered, auditable action — same posture
-- court_sync's manual "Sync Now" already has — not a silent side effect
-- bolted onto already-tested Phase 1 code paths.
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notification_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
    subject VARCHAR(255),
    body TEXT NOT NULL,
    provider VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('sent', 'logged', 'failed')),
    error_message TEXT,
    case_id VARCHAR(50) REFERENCES cases(id) ON DELETE SET NULL,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    hearing_id UUID REFERENCES hearings(id) ON DELETE SET NULL,
    sent_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_log_firm ON notification_log(firm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_recipient ON notification_log(recipient_user_id, created_at DESC);

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'SEND_NOTIFICATION';
