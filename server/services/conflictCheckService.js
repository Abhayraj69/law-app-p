const db = require('../db');

/**
 * Conflict-of-Interest Check
 *
 * Simple normalized-name matching only — no fuzzy matching, no external
 * KYC/sanctions integration. Given the parties named on a new case (the
 * client, the opposing party/counsel, and any related entities), this
 * looks for the same name appearing anywhere among the party-name columns
 * of the firm's existing cases (client_name, opposing_party,
 * opposing_counsel, related_entities) — across every status, since a
 * closed case is still part of the firm's conflict history.
 *
 * Matching is cross-checked, not same-field-only: the interesting
 * conflicts are as much "we've represented this entity before" (any field
 * vs. any field) as "we've been adverse to this entity before" — e.g. a
 * new case's CLIENT matching a past case's OPPOSING_PARTY is exactly the
 * kind of hit a real conflict check exists to catch, and would be missed
 * entirely by only comparing client-to-client.
 *
 * This is intentionally a first pass: exact match on a normalized name,
 * not a similarity/edit-distance search. Simple normalized matching will
 * produce false positives (e.g. two unrelated "Meridian LLC"s) — callers
 * MUST treat a hit as a warning to review, never as a hard block. See
 * CaseService.createCase for how a hit is surfaced and how staff can
 * override it.
 */

const CORPORATE_SUFFIXES = new Set(['inc', 'llc', 'corp', 'corporation', 'co', 'ltd', 'plc', 'lp', 'llp']);

// "Meridian Corp." -> "meridian" ; "Sarah  Jennings" -> "sarah jennings".
// Stripping a single trailing corporate suffix absorbs the most common
// harmless variation ("Meridian Corp" vs "Meridian Corporation") without
// attempting anything fuzzier.
function normalizeName(raw) {
  if (!raw) return '';
  const words = raw
    .toLowerCase()
    .trim()
    .replace(/[.,]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1 && CORPORATE_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(' ');
}

// Field-name pairs -> a human label for why a hit matters, e.g. a new
// case's client matching a past case's opposing party is a materially
// different kind of conflict than matching a past client.
const EXISTING_FIELD_LABEL = {
  client_name: 'prior client',
  opposing_party: 'prior opposing party',
  opposing_counsel: 'prior opposing counsel',
  related_entities: 'prior related entity'
};

const NEW_FIELD_LABEL = {
  client: 'client',
  opposingParty: 'opposing party',
  opposingCounsel: 'opposing counsel',
  relatedEntities: 'related entity'
};

class ConflictCheckService {
  /**
   * Checks the parties on a prospective new case against every existing
   * case's party names for this firm. `parties` is
   * { client, opposingParty, opposingCounsel, relatedEntities } — the same
   * shape CaseService.createCase's payload uses, with relatedEntities as
   * an array of strings.
   *
   * Returns { matches: [...] }, where each match is:
   *   { newField, newValue, caseId, caseName, existingField, existingValue }
   * An empty `matches` array means clear.
   */
  static async checkConflicts(tenantId, parties = {}) {
    const newParties = [
      { field: 'client', values: [parties.client] },
      { field: 'opposingParty', values: [parties.opposingParty] },
      { field: 'opposingCounsel', values: [parties.opposingCounsel] },
      { field: 'relatedEntities', values: parties.relatedEntities || [] }
    ];

    const normalizedNew = [];
    for (const { field, values } of newParties) {
      for (const value of values) {
        const normalized = normalizeName(value);
        if (normalized) normalizedNew.push({ field, value, normalized });
      }
    }
    if (!normalizedNew.length) return { matches: [] };

    const existingCases = await db.listCasePartiesForFirm(tenantId);

    const matches = [];
    for (const existingCase of existingCases) {
      const existingFields = [
        { field: 'client_name', values: [existingCase.client_name] },
        { field: 'opposing_party', values: [existingCase.opposing_party] },
        { field: 'opposing_counsel', values: [existingCase.opposing_counsel] },
        { field: 'related_entities', values: existingCase.related_entities || [] }
      ];

      for (const { field: existingField, values } of existingFields) {
        for (const existingValue of values) {
          const normalizedExisting = normalizeName(existingValue);
          if (!normalizedExisting) continue;

          for (const candidate of normalizedNew) {
            if (candidate.normalized === normalizedExisting) {
              matches.push({
                newField: candidate.field,
                newFieldLabel: NEW_FIELD_LABEL[candidate.field],
                newValue: candidate.value,
                caseId: existingCase.id,
                caseName: existingCase.case_name,
                existingField,
                existingFieldLabel: EXISTING_FIELD_LABEL[existingField],
                existingValue
              });
            }
          }
        }
      }
    }

    return { matches };
  }
}

ConflictCheckService.normalizeName = normalizeName;

module.exports = ConflictCheckService;
