-- ═════════════════════════════════════════════════════════════════════
-- 0005: Add COPILOT_CREATE_CASE audit action
--
-- The AI Copilot's createOrUpdateCase tool previously derived a pseudo
-- "case" view from documents.case_id and never actually wrote to the
-- cases table on commit — see server/services/caseService.js's
-- resolveAndApply and server/controllers/copilotController.js for the
-- real implementation this enables. COPILOT_UPDATE_CASE already existed
-- for the update path; this adds the matching CREATE action so a
-- Copilot-initiated case creation is distinguishable in the audit trail
-- from both a human creating a case (CREATE_CASE, added in 0002) and a
-- Copilot updating an existing one (COPILOT_UPDATE_CASE).
-- ═════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'COPILOT_CREATE_CASE';
