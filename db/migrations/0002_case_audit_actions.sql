-- ═════════════════════════════════════════════════════════════════════
-- 0002: Add CREATE_CASE / ARCHIVE_CASE audit actions
--
-- The Active Cases page's "New Case" and "Archive Case" actions were
-- initially going to reuse the existing COPILOT_UPDATE_CASE audit action,
-- but that value's name specifically means "the AI Copilot changed a
-- case" (see server/controllers/copilotController.js) — reusing it for a
-- human clicking "Create Case Record" in the UI would make the audit
-- trail lie about who/what performed the action. Postgres allows
-- ALTER TYPE ... ADD VALUE inside a transaction (which is how
-- server/db/migrate.js runs every migration file), as long as the new
-- value isn't also used within that same transaction — this file only
-- adds the values, never uses them, so it's safe to run as-is.
-- ═════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CREATE_CASE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ARCHIVE_CASE';
