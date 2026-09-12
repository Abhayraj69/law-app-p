-- ═════════════════════════════════════════════════════════════════════
-- 0010: Add invoice audit actions
--
-- The invoice system was read-only until now (see
-- server/services/invoiceService.js) — this adds the write actions
-- (CREATE_INVOICE, UPDATE_INVOICE, MARK_INVOICE_PAID) so the new
-- create/update/markPaid endpoints have a real audit_action to log under,
-- the same way CREATE_CASE/ARCHIVE_CASE (0002) back the case write paths.
-- ═════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CREATE_INVOICE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPDATE_INVOICE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'MARK_INVOICE_PAID';
