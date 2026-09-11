-- ═════════════════════════════════════════════════════════════════════
-- 0007 (MANUAL — do not move into db/migrations/): drop the plaintext
-- conversation_messages.body column.
--
-- This file lives OUTSIDE db/migrations/ on purpose. server/db/migrate.js
-- auto-applies every *.sql file in that directory at every server boot —
-- if this file were in there, it would run (and irreversibly destroy any
-- not-yet-backfilled plaintext message) the moment someone restarted the
-- server, with no chance to verify the backfill first. It must be run by
-- a human, deliberately, with `psql` or an equivalent client, after every
-- item below is confirmed true.
--
-- DO NOT RUN THIS until ALL of the following are true:
--
--   1. server/scripts/backfillMessageEncryption.js has been run to
--      completion against this database (see its own output — it logs a
--      final "0 plaintext rows remaining" line, and re-running it is
--      always safe/idempotent if you're not sure).
--
--   2. This query returns 0:
--
--        SELECT COUNT(*) FROM conversation_messages
--        WHERE body IS NOT NULL AND body_ciphertext IS NULL;
--
--   3. The application has been running against the encrypted columns
--      (post-0006-migration code) for long enough that you're confident
--      there's no rollback scenario that would need the plaintext `body`
--      column still present as a fallback.
--
--   4. You have a recent, verified database backup/snapshot taken BEFORE
--      running this — dropping a column is not reversible by any of the
--      tooling in this project.
--
-- After this runs, server/services/encryption/messageEncryptionService.js's
-- resolveMessageBody() legacy-plaintext fallback branch becomes dead code
-- (every row will have body_ciphertext set) — safe to delete at that
-- point, but not required to.
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE conversation_messages DROP COLUMN body;

-- The CHECK constraint added in 0006 referenced `body` and no longer
-- makes sense once it's gone — every remaining row is unconditionally
-- fully encrypted, which the four NOT NULL-equivalent columns below
-- enforce on their own.
ALTER TABLE conversation_messages DROP CONSTRAINT IF EXISTS chk_body_encryption_consistent;
ALTER TABLE conversation_messages ALTER COLUMN body_ciphertext SET NOT NULL;
ALTER TABLE conversation_messages ALTER COLUMN body_nonce SET NOT NULL;
ALTER TABLE conversation_messages ALTER COLUMN body_auth_tag SET NOT NULL;
ALTER TABLE conversation_messages ALTER COLUMN encryption_key_id SET NOT NULL;
