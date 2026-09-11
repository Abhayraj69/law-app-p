-- ═════════════════════════════════════════════════════════════════════
-- 0006: Application-level encryption for conversation_messages.body
--
-- This is a purely ADDITIVE migration — it never touches existing data
-- and never drops anything, so it's safe to apply to a live database with
-- no downtime. It's step 1 of a multi-step rollout:
--   1. (this file) add the new columns + encryption_keys table.
--   2. Deploy the application code that encrypts new writes and can read
--      both old (plaintext `body`) and new (ciphertext) rows.
--   3. Run the backfill script (server/scripts/backfillMessageEncryption.js)
--      to encrypt every pre-existing plaintext message.
--   4. Once backfill is verified 100% complete, run
--      db/manual-migrations/0007_drop_plaintext_message_body.sql by hand
--      — deliberately NOT in this migrations/ directory, so it can never
--      be auto-applied by server/db/migrate.js before the backfill is
--      actually done. See that file and README.md's "Message encryption"
--      section for the full runbook.
-- ═════════════════════════════════════════════════════════════════════

-- Which KMS (or, in development only, local) provider wrapped a given
-- data encryption key, and its wrapped (never plaintext) form. Multiple
-- rows accumulate over time as keys are rotated — a retired key's row is
-- kept forever (never deleted), because any message encrypted under it
-- needs that row to ever be decrypted again.
CREATE TABLE IF NOT EXISTS encryption_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('aws_kms', 'local')),
    -- The KMS customer master key ARN this DEK is wrapped under (NULL for
    -- the local dev-only provider, which has no KMS master key at all).
    kms_key_arn TEXT,
    -- The wrapped (encrypted) data encryption key — for aws_kms this is
    -- KMS's own CiphertextBlob; for local, messageCipher-encrypted bytes
    -- under MESSAGE_ENCRYPTION_LOCAL_KEY. NEVER a plaintext key.
    wrapped_dek BYTEA NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    retired_at TIMESTAMP WITH TIME ZONE
);

-- At most one ACTIVE key per provider at any time — a real database-level
-- invariant, not just an application-level convention. (A partial unique
-- index: the constraint only applies to rows where status = 'active', so
-- any number of 'retired' rows can coexist.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_key_per_provider
    ON encryption_keys (provider) WHERE status = 'active';

-- conversation_messages: the encrypted fields, added alongside (not
-- instead of) the existing plaintext `body` column.
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS body_ciphertext BYTEA;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS body_nonce BYTEA;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS body_auth_tag BYTEA;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS encryption_key_id UUID REFERENCES encryption_keys(id);

-- `body` was NOT NULL — every NEW message row going forward populates
-- only the encrypted columns above and leaves `body` NULL, so that
-- constraint has to go. (Existing plaintext rows are untouched by this
-- migration; they keep their `body` value until the backfill script
-- encrypts them — see the file header.)
ALTER TABLE conversation_messages ALTER COLUMN body DROP NOT NULL;

-- A message is either fully encrypted (all four new columns set) or
-- still legacy-plaintext (`body` set, encrypted columns all NULL) — never
-- a partial/inconsistent mix, which would make resolveMessageBody's
-- fallback logic (server/services/encryption/messageEncryptionService.js)
-- ambiguous about which representation to trust.
ALTER TABLE conversation_messages ADD CONSTRAINT chk_body_encryption_consistent CHECK (
    (body_ciphertext IS NOT NULL AND body_nonce IS NOT NULL AND body_auth_tag IS NOT NULL AND encryption_key_id IS NOT NULL AND body IS NULL)
    OR
    (body_ciphertext IS NULL AND body_nonce IS NULL AND body_auth_tag IS NULL AND encryption_key_id IS NULL AND body IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_encryption_key ON conversation_messages(encryption_key_id);
