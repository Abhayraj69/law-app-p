-- ═════════════════════════════════════════════════════════════════════
-- 0018: Structured message attachments
--
-- Until now, the Communications composer's "Attach" quick action really
-- uploaded a file through the vault upload pipeline, but conversation_messages
-- had no column to link it — the message only carried a plain-text mention
-- of the filename (see README's "What's still mock/static", now resolved).
-- This adds a single nullable FK instead of a separate join table: a
-- message carries at most one attachment, matching what the composer UI
-- has always offered (one file picked per "Attach" click).
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE conversation_messages
    ADD COLUMN IF NOT EXISTS attachment_document_id UUID REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_attachment
    ON conversation_messages(attachment_document_id)
    WHERE attachment_document_id IS NOT NULL;
