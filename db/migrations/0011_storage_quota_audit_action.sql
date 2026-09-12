-- ═════════════════════════════════════════════════════════════════════
-- 0011: Add UPDATE_STORAGE_QUOTA audit action
--
-- Backs the new Settings > Storage admin view (server/services/
-- storageQuotaService.js) — an ADMIN raising or lowering a firm's storage
-- limit is exactly the kind of privileged change the audit trail should
-- capture, same reasoning as 0002/0004/0010's write-action additions.
-- ═════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPDATE_STORAGE_QUOTA';
