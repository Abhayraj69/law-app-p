-- ═════════════════════════════════════════════════════════════════════
-- 0013: Add conflict-check audit actions
--
-- ConflictCheckService runs a normalized-name conflict check on every new
-- case (see server/services/conflictCheckService.js and its wiring into
-- CaseService.createCase). Every run is logged — clear, hit, or an
-- explicit staff override of a hit — the same way CREATE_INVOICE etc.
-- (0010) back the invoice write paths.
-- ═════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CONFLICT_CHECK_CLEAR';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CONFLICT_CHECK_HIT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CONFLICT_CHECK_OVERRIDE';
