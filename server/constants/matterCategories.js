/**
 * Matter classification taxonomy.
 *
 * Before this, "practice area" existed only as a free-text
 * cases.case_type VARCHAR(100) column with no server-side validation, plus
 * an identical hardcoded <select> duplicated in two places in index.html
 * (the New Case modal and the case filter bar) — a UI convention, not a
 * real taxonomy. This promotes that same 8-value list into one real,
 * server-validated constant that ConsultationService checks new intake
 * against, rather than either inventing a competing list or leaving Phase
 * 2's "matter classification taxonomy" unenforced the same way case_type
 * already is.
 *
 * Deliberately NOT retrofitted onto cases.case_type itself — that column
 * already holds years of unconstrained values (seed data, existing rows),
 * and turning it into a hard enum now risks breaking rows this list
 * doesn't happen to cover. New code (consultations) gets the real
 * taxonomy; old code (cases.case_type) is left exactly as it was.
 */

const MATTER_CATEGORIES = [
  'Commercial Litigation',
  'Criminal Defense',
  'Family Law',
  'Probate & Estate',
  'Intellectual Property',
  'Administrative Law',
  'Employment Law',
  'Bankruptcy'
];

module.exports = { MATTER_CATEGORIES };
