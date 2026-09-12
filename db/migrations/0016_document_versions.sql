-- ═════════════════════════════════════════════════════════════════════
-- 0016: Document version history
--
-- Re-uploading a file had no re-upload path at all until now — only fresh
-- upload (always a new document row) and metadata-only PATCH existed. This
-- adds a real re-upload path (POST /api/v1/files/:id/versions) backed by
-- an append-only document_versions table, so a new upload of an existing
-- document creates a new version instead of overwriting anything.
--
-- documents.version (already existed, DEFAULT 1, never previously written
-- by any code) becomes the "current version number" pointer; documents.*
-- (storage_path_url, file_size_bytes, file_type, original_name, file_name)
-- keep mirroring whatever the LATEST version is, so GET
-- /api/v1/files/:id/download / /preview need no code changes to keep
-- serving the current version.
--
-- Old versions are never deleted from disk (see FileService.saveUploaded
-- File's new version-numbered filename scheme) — see the accompanying
-- backend change to server/db.js's insertDocumentVersionAndPromote, which
-- bumps storage_quotas explicitly, because trigger_document_storage_quota
-- (db/schema.sql) only fires on documents INSERT/DELETE/is_deleted, never
-- on a plain file_size_bytes UPDATE.
-- ═════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPLOAD_VERSION';

CREATE TABLE IF NOT EXISTS document_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    storage_path_url TEXT NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes >= 0),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    comment TEXT,
    CONSTRAINT unique_version_per_document UNIQUE (document_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON document_versions(document_id, version_number DESC);

-- Backfill: every existing document (including soft-deleted ones, so
-- their history isn't silently dropped) becomes its own version 1,
-- pointing at whatever it already has on disk today — no files are moved
-- or renamed by this migration, only this metadata row is added.
INSERT INTO document_versions (document_id, version_number, storage_path_url, original_name, file_type, file_size_bytes, uploaded_by, uploaded_at, comment)
SELECT d.id, 1, d.storage_path_url, d.original_name, d.file_type, d.file_size_bytes, d.author_id, d.created_at, NULL
FROM documents d
WHERE NOT EXISTS (
    SELECT 1 FROM document_versions dv WHERE dv.document_id = d.id AND dv.version_number = 1
);

UPDATE documents SET version = 1 WHERE version IS DISTINCT FROM 1;
