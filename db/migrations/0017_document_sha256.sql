-- ═════════════════════════════════════════════════════════════════════
-- 0017: Persist documents.sha256 and use it for real duplicate detection
--
-- FileService.saveUploadedFile has always computed a sha256 of the
-- uploaded bytes and handed it back to VaultService.initiateUpload, but
-- nothing ever stored it — db.insertDocument silently dropped the field.
-- That made "is this a duplicate?" only ever answerable by comparing
-- filename + size, which false-positives (two different files that
-- happen to share a name and byte count) and false-negatives (the same
-- file re-uploaded under a different name). A real content hash fixes
-- both.
--
-- Nullable because existing rows were never hashed at upload time and
-- there is no re-upload event to backfill them from — a NULL sha256
-- simply never participates in the duplicate check (see
-- VaultService.initiateUpload), the same "not yet backfilled" posture
-- migration 0006 took for message encryption.
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE documents ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(firm_id, sha256) WHERE sha256 IS NOT NULL;
