const db = require('../db');

/**
 * Case Service
 * Backs the Active Cases page. Replaces the hardcoded `CASES` array that
 * used to live in app.js — see README.md for the real-vs-mock history.
 *
 * Role scoping: every read here ultimately goes through
 * db.listCasesForUser / db.getCaseByIdForUser, which restrict a CLIENT-role
 * caller to only the cases where `client_user_id` matches their own id.
 * This service never re-derives that filter itself, so there's exactly one
 * place (server/db.js) that can get it wrong.
 */

// A small fixed palette, picked deterministically per attorney (by id) so
// the same attorney always renders the same color across requests without
// having to store a color column anywhere.
const ATTORNEY_COLORS = ['#C9A84C', '#3B82F6', '#2DC8B0', '#9B59B6', '#F39C12', '#E74C3C', '#1ABC9C'];

function colorForAttorney(attorneyId) {
  if (!attorneyId) return '#95A5A6';
  let hash = 0;
  for (const ch of attorneyId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ATTORNEY_COLORS[hash % ATTORNEY_COLORS.length];
}

// "Sarah Jennings" -> "Sarah J." — matches the shorthand the UI has always
// displayed for the lead attorney column/filter.
function shorthandName(fullName) {
  if (!fullName) return 'Unassigned';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function initialsFor(fullName, stored) {
  if (stored) return stored;
  if (!fullName) return 'XX';
  return fullName.trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function formatRelativeTime(date) {
  if (!date) return '';
  const diffMs = Date.now() - new Date(date).getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return '1 day ago';
  if (diffDay < 7) return `${diffDay} days ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek} week${diffWeek === 1 ? '' : 's'} ago`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth} month${diffMonth === 1 ? '' : 's'} ago`;
}

// `dateVal` is the raw 'YYYY-MM-DD' string a DATE column comes back as
// (see server/db/pool.js's DATE type-parser override) — a date-only ISO
// string is spec'd to parse as UTC midnight, so it must be READ with
// timeZone: 'UTC' too, or a host whose local timezone is behind UTC would
// render the day before.
function formatHearingDate(dateVal) {
  if (!dateVal) return 'None';
  const d = new Date(dateVal);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function toCaseView(row) {
  return {
    id: row.id,
    name: row.case_name,
    client: row.client_name,
    opposingParty: row.opposing_party,
    opposingCounsel: row.opposing_counsel,
    status: row.status,
    attorney: shorthandName(row.lead_attorney_name),
    lead_attorney_id: row.lead_attorney_id,
    initials: initialsFor(row.lead_attorney_name, row.lead_attorney_initials),
    color: colorForAttorney(row.lead_attorney_id),
    activity: formatRelativeTime(row.updated_at),
    type: row.case_type,
    nextHearing: formatHearingDate(row.next_hearing_date),
    createdDate: row.created_at,
    client_user_id: row.client_user_id
  };
}

function notFound() {
  const err = new Error('Case not found.');
  err.status = 404;
  return err;
}

class CaseService {
  /** GET /api/v1/cases — role-scoped list backing the Active Cases table. */
  static async listCases(tenantId, user) {
    const rows = await db.listCasesForUser(tenantId, user);
    return rows.map(toCaseView);
  }

  /** GET /api/v1/cases/:id — role-scoped single case lookup. */
  static async getCase(tenantId, caseId, user) {
    const row = await db.getCaseByIdForUser(tenantId, caseId, user);
    if (!row) throw notFound();
    return toCaseView(row);
  }

  /**
   * POST /api/v1/cases — create a new case from the "New Case" modal.
   * `attorney` arrives as the shorthand shown in the form's select (e.g.
   * "Sarah J.") — matched back to a real user id so the case has a proper
   * FK, not just a display string.
   */
  static async createCase(tenantId, actingUser, payload = {}) {
    const { title, client, opposingParty, opposingCounsel, area, attorney, status, hearing } = payload;

    if (!title || !title.trim() || !client || !client.trim()) {
      const err = new Error('Case title and client name are required.');
      err.status = 400;
      throw err;
    }

    const users = await db.listUsersByFirm(tenantId);
    const matchedAttorney = users.find(u => shorthandName(u.full_name) === attorney);

    const year = new Date().getFullYear();
    const maxNum = await db.getMaxCaseNumber(tenantId);
    const id = `LC-${year}-${String(maxNum + 1).padStart(3, '0')}`;

    await db.insertCase({
      id,
      firmId: tenantId,
      caseName: title.trim(),
      clientName: client.trim(),
      opposingParty: opposingParty || null,
      opposingCounsel: opposingCounsel || null,
      status: status || 'active',
      leadAttorneyId: matchedAttorney ? matchedAttorney.id : null,
      caseType: area || null
    });

    if (hearing && hearing.trim() && hearing.trim().toLowerCase() !== 'none') {
      // Parsed as the local calendar date the user typed (e.g. "Jul 31,
      // 2026") and re-assembled from LOCAL getters, not via
      // .toISOString() — that converts through UTC and would shift the
      // date by a day on any host whose local timezone isn't UTC itself.
      const parsed = new Date(hearing);
      if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const dd = String(parsed.getDate()).padStart(2, '0');
        await db.insertCaseDeadline({
          firmId: tenantId,
          caseId: id,
          title: `${title.trim()} — Hearing`,
          deadlineDate: `${y}-${m}-${dd}`,
          badgeType: 'Hearing'
        });
      }
    }

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser ? actingUser.id : null,
      action: 'CREATE_CASE',
      details: { case_id: id, case_name: title.trim() }
    });

    const row = await db.getCaseByIdForUser(tenantId, id, null);
    return toCaseView(row);
  }

  /** Used by the "Archive Case" row action — sets status to 'closed'. */
  static async archiveCase(tenantId, actingUser, caseId) {
    const updated = await db.updateCaseStatus(tenantId, caseId, 'closed');
    if (!updated) throw notFound();

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser ? actingUser.id : null,
      action: 'ARCHIVE_CASE',
      details: { case_id: caseId }
    });

    const row = await db.getCaseByIdForUser(tenantId, caseId, null);
    return toCaseView(row);
  }
}

module.exports = CaseService;
