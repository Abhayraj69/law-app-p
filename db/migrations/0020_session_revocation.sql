-- ═════════════════════════════════════════════════════════════════════
-- 0020: Session revocation
--
-- Until now a signed JWT was valid for its full 12-hour TTL no matter
-- what happened in between: "log out" only cleared localStorage in the
-- browser, so a token already copied off the machine kept working, and
-- an admin had no way to cut off a departing employee's access short of
-- deleting their user row. For an app holding privileged legal documents
-- that is a long time to be unable to say "no, not any more."
--
-- Two complementary mechanisms, because they answer different questions:
--
--   revoked_tokens  — "this ONE session is over." Keyed by the token's
--                     jti claim (added in server/services/authService.js).
--                     This is what POST /api/v1/auth/logout writes.
--
--   users.sessions_valid_from — "EVERY session this user currently has is
--                     over." A single timestamp compared against the
--                     token's iat claim, so one row update invalidates
--                     every outstanding token for that user at once
--                     without having to enumerate them. This is what an
--                     admin force-logout and a password change use.
--
-- The timestamp approach is why this is not just a table: revoking "all
-- sessions" through revoked_tokens alone would require knowing every jti
-- ever issued, which the server deliberately does not store.
-- ═════════════════════════════════════════════════════════════════════

-- One row per explicitly revoked token. Rows are only needed until the
-- token would have expired naturally, at which point jwt.verify rejects
-- it anyway — see cleanupExpiredRevocations() in server/db.js.
CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The token's own exp, so expired rows can be swept without having
    -- to decode anything.
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Supports the periodic sweep of rows that have aged out.
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);

-- Every token issued before this moment is treated as invalid for this
-- user. Defaults to the epoch rather than now() so that applying this
-- migration does not log every currently signed-in user out.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMP WITH TIME ZONE
    NOT NULL DEFAULT TIMESTAMP WITH TIME ZONE 'epoch';

-- LOGOUT is recorded like any other security-relevant action;
-- REVOKE_SESSIONS is the privileged one (an ADMIN ending someone else's
-- sessions), and is exactly the kind of change the audit trail exists
-- for -- same reasoning as 0002/0004/0010/0011.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'LOGOUT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'REVOKE_SESSIONS';
