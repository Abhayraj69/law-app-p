-- ═════════════════════════════════════════════════════════════════════
-- 0003: Admin-invite user provisioning
--
-- Before this migration, the ONLY way to add a user was running
-- `npm run seed` with a new hardcoded entry and restarting the process —
-- not something the app itself could do. This adds a real invite flow:
-- an ADMIN creates a placeholder user row (with an unusable, random
-- password_hash — never a hash of anything guessable) plus a one-time
-- invite token, and the invitee sets their OWN password via that link.
-- The admin never learns or sets the invitee's password, unlike the old
-- seed-script model where whoever ran the seed script knew every initial
-- password.
--
-- Firm-provisioning stays single-firm: nothing here lets an invitee pick
-- their own firm_id or self-register outside an invite — see
-- server/services/inviteService.js.
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_invites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    -- The placeholder user row this invite will activate. ON DELETE
    -- CASCADE: if the placeholder user is ever removed before the invite
    -- is accepted, the dangling invite goes with it.
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Only a SHA-256 hash of the raw invite token is stored — same
    -- reasoning as password_hash: a database leak must not hand out
    -- usable invite links, only irreversible hashes of them.
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_invites_token_hash ON user_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_invites_firm ON user_invites(firm_id);
