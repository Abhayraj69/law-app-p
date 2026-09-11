-- ═════════════════════════════════════════════════════════════════════
-- 0004: Add CREATE_USER_INVITE audit action
--
-- Who invited whom, and when, is exactly the kind of thing a legal
-- practice's audit trail should capture — same reasoning as 0002's
-- CREATE_CASE/ARCHIVE_CASE. See that file's comment for why ADD VALUE is
-- safe to run inside the transaction server/db/migrate.js wraps this in
-- (it only adds the value, never uses it in the same transaction).
-- ═════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CREATE_USER_INVITE';
