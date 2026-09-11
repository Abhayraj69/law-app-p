-- ═════════════════════════════════════════════════════════════════════
-- 0008: Scope encryption_keys to a firm
--
-- 0006 gave every firm in a deployment ONE SHARED active key per
-- provider — fine for this app's single-firm-per-deployment model in
-- practice, but a real gap for any deployment with more than one firm
-- row: a key compromise, rotation, or legal hold on one firm's messages
-- would affect every other firm sharing that key, and there'd be no way
-- to rotate or retire one firm's key independently of another's.
--
-- This makes each firm's active key independent: the partial unique
-- index moves from "one active key per provider" to "one active key per
-- (provider, firm)", so firm A and firm B each mint, cache, and rotate
-- their own DEK under the same shared KMS master key (KMS_KEY_ARN)
-- without affecting each other.
--
-- Existing key rows (from before this migration) have no firm — every
-- message encrypted so far in this codebase's history was encrypted
-- under one of them, and in every real deployment of this app to date
-- that's been the single seeded DEFAULT_FIRM_ID. They're backfilled to
-- that firm rather than left NULL, since a key with no firm can't be
-- looked up by the new firm-scoped queries at all — see
-- server/db.js's getActiveEncryptionKey/insertEncryptionKey/
-- retireActiveEncryptionKeys, all now firm_id-aware. If DEFAULT_FIRM_ID
-- doesn't exist in this particular database (a from-scratch test
-- database that never seeded it, for instance), there's no valid firm to
-- assign an orphaned key row to — those are deleted instead, rather than
-- leaving a row that would fail the NOT NULL constraint added below.
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE encryption_keys ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES firms(id) ON DELETE CASCADE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM firms WHERE id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479') THEN
        UPDATE encryption_keys SET firm_id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479' WHERE firm_id IS NULL;
    END IF;
    DELETE FROM encryption_keys WHERE firm_id IS NULL;
END $$;

ALTER TABLE encryption_keys ALTER COLUMN firm_id SET NOT NULL;

-- Replace the old provider-only uniqueness with provider+firm.
DROP INDEX IF EXISTS idx_one_active_key_per_provider;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_key_per_provider_firm
    ON encryption_keys (provider, firm_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_encryption_keys_firm ON encryption_keys(firm_id);
