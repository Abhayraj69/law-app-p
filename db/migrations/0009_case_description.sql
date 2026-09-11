-- ═════════════════════════════════════════════════════════════════════
-- 0009: Add a free-text description field to cases
--
-- The client portal's case detail view (client-portal.js) needs
-- somewhere to show what a matter is actually about, beyond the
-- structured fields (status, type, opposing party/counsel) the Active
-- Cases table already had. Nullable and with no default: existing rows
-- simply have no description until staff (or the AI Copilot, via the
-- same updateCaseFields path used for status/opposing-party edits) add
-- one — the portal renders that as "No description on file yet."
-- rather than treating a missing description as an error.
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE cases ADD COLUMN IF NOT EXISTS description TEXT;
