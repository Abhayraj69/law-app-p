-- ═════════════════════════════════════════════════════════════════════
-- 0012: Add cases.related_entities
--
-- Conflict-of-interest checking (see server/services/conflictCheckService.js)
-- needs to compare more than just client_name/opposing_party/opposing_counsel
-- against a firm's case history — e.g. parent companies, subsidiaries, or
-- other named parties tied to a case that aren't the client or the direct
-- opposing party. Stored as a plain text array since these are free-form
-- names, same as every other party-name column on this table.
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE cases ADD COLUMN IF NOT EXISTS related_entities TEXT[] NOT NULL DEFAULT '{}';
