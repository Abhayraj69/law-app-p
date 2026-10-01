-- ═════════════════════════════════════════════════════════════════════
-- 0030: Two-factor authentication (Phase 6)
--
-- TOTP (RFC 6238), verified against a secret this app generates and stores
-- per user — see server/services/totp.js (implemented directly against
-- Node's crypto module, checked against RFC 4226's own published test
-- vectors, rather than a third-party dependency for something this
-- narrowly scoped).
--
-- totp_secret is written at "start setup" time and stays there
-- unconfirmed until the user proves they can generate a real code from it
-- (totp_enabled flips to TRUE only then) — an abandoned setup just leaves
-- an unused secret sitting on the row, which is harmless since
-- totp_enabled, not the presence of a secret, is what the login flow
-- actually checks.
--
-- totp_recovery_codes stores bcrypt HASHES of one-time recovery codes,
-- same posture as users.password_hash — the plaintext codes are shown to
-- the user exactly once, at enable time, and can never be read back.
-- Each hash is removed from the array the moment its code is used, so a
-- recovery code is provably single-use without needing a separate
-- used/unused flag per code.
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS totp_secret TEXT,
    ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS totp_confirmed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS totp_recovery_codes TEXT[] NOT NULL DEFAULT '{}';

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ENABLE_2FA';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'DISABLE_2FA';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USE_2FA_RECOVERY_CODE';
