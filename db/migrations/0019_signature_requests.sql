-- ═════════════════════════════════════════════════════════════════════
-- 0019: Pluggable e-signature workflow
--
-- Until now the "Request Signature" composer button was a disabled
-- "Coming soon" placeholder, and Matter Intake's SIGNED step was only
-- ever reached by a staff member manually uploading a countersigned file
-- (case_intake.signed_document_id — see migration 0015's comment: "just
-- a document id + timestamp so a future e-signature integration... is a
-- drop-in, not a schema change"). This adds a real, self-contained
-- request/status-tracking workflow behind a pluggable provider
-- (server/services/esignature/) with a working 'local' provider that
-- needs no third-party account: the signer completes the request on this
-- app's own public /sign-document.html page (reached via a one-time
-- token, same shape as user_invites), not a forged callback from a
-- service that was never actually called. Swapping in a real provider
-- (DocuSign, HelloSign) later is adding one more file under
-- server/services/esignature/providers/, not a schema change.
--
-- signature_request_events is an append-only log, same posture as
-- case_intake_events / trust_transactions — a correction is a new event,
-- never an edited or deleted one.
-- ═════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CREATE_SIGNATURE_REQUEST';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'COMPLETE_SIGNATURE_REQUEST';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'VOID_SIGNATURE_REQUEST';

CREATE TYPE signature_request_status AS ENUM ('sent', 'signed', 'voided');

CREATE TABLE IF NOT EXISTS signature_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    -- Optional: a signature request can stand alone (any document, any
    -- signer) or be tied to a case, in which case a completed 'sent'
    -- request for a case still in Matter Intake's ENGAGEMENT_LETTER_SENT
    -- state auto-advances that intake to SIGNED (see
    -- MatterIntakeService.markSignedViaSignatureRequest).
    case_id VARCHAR(50) REFERENCES cases(id) ON DELETE SET NULL,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    requested_by UUID REFERENCES users(id),
    signer_name TEXT NOT NULL,
    signer_email TEXT NOT NULL,
    provider VARCHAR(20) NOT NULL DEFAULT 'local',
    status signature_request_status NOT NULL DEFAULT 'sent',
    -- Only the SHA-256 hash of the one-time signing link's token is ever
    -- stored, same posture as user_invites.token_hash — the raw token is
    -- returned to the requester exactly once, at creation time.
    token_hash TEXT NOT NULL UNIQUE,
    signer_typed_name TEXT,
    signer_ip TEXT,
    -- Deliberately just a document id + timestamp, same contract as
    -- case_intake.signed_document_id (0015) — the 'local' provider
    -- doesn't stamp or re-render the document, it points back at the
    -- same one that was sent for signature, alongside the real signer
    -- metadata (typed name, ip, completed_at) recorded on this row.
    signed_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    voided_at TIMESTAMP WITH TIME ZONE,
    voided_reason TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signature_requests_firm ON signature_requests(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_signature_requests_case ON signature_requests(case_id);

CREATE TABLE IF NOT EXISTS signature_request_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    signature_request_id UUID NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL,
    -- NULL for the signer's own public completion action (they have no
    -- user row) — non-NULL for staff-initiated events (SENT, VOIDED).
    actor_id UUID REFERENCES users(id),
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signature_request_events_request ON signature_request_events(signature_request_id, created_at);
