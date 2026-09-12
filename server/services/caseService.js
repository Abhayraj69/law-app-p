const db = require('../db');
const VaultService = require('./vaultService');
const ConflictCheckService = require('./conflictCheckService');

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

// `dateVal` is the raw 'YYYY-MM-DD' string described above formatHearingDate.
// Comparing two such strings lexicographically gives the same result as
// comparing them chronologically, so this sidesteps the local-midnight
// footgun entirely rather than routing through a JS Date at all.
// `badgeType` distinguishes a missed court appearance (Hearing/Trial) —
// worth flagging to a client — from a merely-elapsed paperwork deadline
// (Discovery/Filing), which is just "past", not something gone wrong.
function deadlineStatus(dateVal, badgeType, todayVal) {
  if (dateVal >= todayVal) return 'upcoming';
  return (badgeType === 'Hearing' || badgeType === 'Trial') ? 'missed' : 'past';
}

function toCaseView(row) {
  return {
    id: row.id,
    name: row.case_name,
    client: row.client_name,
    opposingParty: row.opposing_party,
    opposingCounsel: row.opposing_counsel,
    relatedEntities: row.related_entities || [],
    status: row.status,
    attorney: shorthandName(row.lead_attorney_name),
    lead_attorney_id: row.lead_attorney_id,
    initials: initialsFor(row.lead_attorney_name, row.lead_attorney_initials),
    color: colorForAttorney(row.lead_attorney_id),
    activity: formatRelativeTime(row.updated_at),
    type: row.case_type,
    nextHearing: formatHearingDate(row.next_hearing_date),
    createdDate: row.created_at,
    client_user_id: row.client_user_id,
    description: row.description
  };
}

function notFound() {
  const err = new Error('Case not found.');
  err.status = 404;
  return err;
}

// Same rule CommunicationsService applies: everyone except a CLIENT is
// "staff" for the purposes of what they're allowed to see (here, internal
// 'note' messages in the case activity timeline).
function isStaff(user) {
  return !!user && user.role !== 'CLIENT';
}

// Label/type shown per activity-feed row. Case-lifecycle and document
// actions come straight from the audit_action enum; MESSAGE_CLIENT/
// MESSAGE_STAFF/MESSAGE_NOTE are synthesized in db.listActivityForCase
// (conversation_messages has no audit_action of its own).
const ACTIVITY_LABEL_BY_ACTION = {
  CREATE_CASE: 'Case opened',
  COPILOT_CREATE_CASE: 'Case opened (via AI Copilot)',
  ARCHIVE_CASE: 'Case closed',
  COPILOT_UPDATE_CASE: 'Case updated (via AI Copilot)',
  UPLOAD: 'Document uploaded',
  UPDATE_METADATA: 'Document updated',
  DELETE: 'Document deleted',
  FLAG: 'Document flagged for review',
  UNFLAG: 'Document unflagged',
  SHARE: 'Document shared',
  VIEW: 'Document viewed',
  PREVIEW: 'Document previewed',
  DOWNLOAD: 'Document downloaded',
  COPILOT_MOVE: 'Document moved (via AI Copilot)',
  COPILOT_RENAME: 'Document renamed (via AI Copilot)',
  COPILOT_TAG: 'Document tagged (via AI Copilot)',
  COPILOT_DELETE: 'Document deleted (via AI Copilot)',
  MESSAGE_CLIENT: 'Message sent',
  MESSAGE_STAFF: 'Message from your legal team',
  MESSAGE_NOTE: 'Internal note added'
};

const ACTIVITY_TYPE_BY_ACTION = {
  CREATE_CASE: 'case', COPILOT_CREATE_CASE: 'case', ARCHIVE_CASE: 'case', COPILOT_UPDATE_CASE: 'case',
  UPLOAD: 'document', UPDATE_METADATA: 'document', DELETE: 'document', FLAG: 'document',
  UNFLAG: 'document', SHARE: 'document', VIEW: 'document', PREVIEW: 'document', DOWNLOAD: 'document',
  COPILOT_MOVE: 'document', COPILOT_RENAME: 'document',
  COPILOT_TAG: 'document', COPILOT_DELETE: 'document',
  MESSAGE_CLIENT: 'message', MESSAGE_STAFF: 'message', MESSAGE_NOTE: 'message'
};

function toActivityView(row) {
  return {
    id: row.id,
    type: ACTIVITY_TYPE_BY_ACTION[row.action] || 'other',
    label: ACTIVITY_LABEL_BY_ACTION[row.action] || row.action,
    actorName: row.actor_name || null,
    targetName: row.target_name || null,
    date: row.created_at
  };
}

// The only statuses the rest of the app actually understands (status
// pills/badges on the Active Cases page, the dashboard's active-case
// count, etc.). Writing anything else into `cases.status` wouldn't be
// rejected by the database — there's no CHECK constraint on that column —
// but it would silently break the UI, so it's validated in application
// code wherever a caller-supplied status can reach the table.
const VALID_STATUSES = ['active', 'pending', 'urgent', 'closed'];

class CaseService {
  /**
   * Resolves a shorthand like "Sarah J." (first name + last initial —
   * what the case table/filters/forms have always displayed) to a real
   * user row. Returns null if nothing matches; never throws, so callers
   * decide for themselves whether a miss is fatal (creating a case with
   * no lead attorney is fine; failing to UPDATE one to a name that
   * doesn't resolve to anyone should not be silently ignored — see
   * applyFieldUpdate below).
   */
  static async resolveAttorneyByShorthand(tenantId, shorthand) {
    if (!shorthand) return null;
    const users = await db.listUsersByFirm(tenantId);
    return users.find(u => shorthandName(u.full_name) === shorthand) || null;
  }

  /**
   * Resolves a case reference to a real row, or null if nothing matches.
   * Two-step: an exact `caseId` match first (the common path — most
   * callers, including a human via the UI, already know the real id);
   * falling back to an exact (not fuzzy) case-insensitive `caseName`
   * match only if the id didn't resolve. A caller that supplies a name
   * matching more than one case gets a 409 rather than an arbitrary pick
   * — silently guessing which case an AI tool or API caller meant would
   * be a worse failure mode than asking them to disambiguate.
   */
  static async resolveCaseIdentity(tenantId, { caseId, caseName } = {}) {
    if (caseId) {
      const byId = await db.getCaseByIdForUser(tenantId, caseId, null);
      if (byId) return { case: toCaseView(byId), matchedBy: 'id' };
    }

    if (caseName && caseName.trim()) {
      const matches = await db.findCasesByExactName(tenantId, caseName.trim());
      if (matches.length === 1) return { case: toCaseView(matches[0]), matchedBy: 'name' };
      if (matches.length > 1) {
        const err = new Error(`Multiple cases are named "${caseName}" — ambiguous. Specify the exact case_id instead.`);
        err.status = 409;
        err.code = 'AMBIGUOUS_CASE_NAME';
        throw err;
      }
    }

    return { case: null, matchedBy: null };
  }

  /**
   * Applies status/attorney/opposing-party/case-type changes to an
   * EXISTING case (by real id). Every field is validated against
   * something real before it touches the row:
   *   - status must be one of VALID_STATUSES.
   *   - lead_attorney (a shorthand string) must resolve to a real user —
   *     an unresolvable name is a hard error, not a silent no-op, since
   *     silently failing to reassign a case's attorney is exactly the
   *     kind of mistake a legal practice's audit trail exists to catch.
   */
  static async applyFieldUpdate(tenantId, caseId, payload = {}) {
    const updates = {};

    if (payload.status !== undefined) {
      if (!VALID_STATUSES.includes(payload.status)) {
        const err = new Error(`Invalid status "${payload.status}". Must be one of: ${VALID_STATUSES.join(', ')}.`);
        err.status = 400;
        throw err;
      }
      updates.status = payload.status;
    }

    if (payload.lead_attorney !== undefined) {
      const attorney = await this.resolveAttorneyByShorthand(tenantId, payload.lead_attorney);
      if (!attorney) {
        const err = new Error(`No attorney matches "${payload.lead_attorney}". Expected a shorthand like "Sarah J." (first name + last initial) matching a firm user.`);
        err.status = 400;
        err.code = 'ATTORNEY_NOT_FOUND';
        throw err;
      }
      updates.leadAttorneyId = attorney.id;
    }

    if (payload.opposing_party !== undefined) updates.opposingParty = payload.opposing_party;
    if (payload.opposing_counsel !== undefined) updates.opposingCounsel = payload.opposing_counsel;
    if (payload.case_type !== undefined) updates.caseType = payload.case_type;

    const row = await db.updateCaseFields(tenantId, caseId, updates);
    if (!row) throw notFound();
    return toCaseView(row);
  }

  /**
   * The entry point for a caller (the AI Copilot's createOrUpdateCase
   * tool) that only has an opaque case reference — an id that might not
   * exist yet, optionally alongside a case_name — not a guaranteed real
   * id the way the UI's edit/archive actions do. Resolves identity first;
   * updates the match if one exists, otherwise creates a new case IF the
   * payload has enough information to (case_name + client_name), and
   * refuses with 404 otherwise rather than silently inventing a case
   * from partial information.
   *
   * A brand-new case is always given a freshly minted id (see createCase)
   * — the caller's own `caseId` is only ever a resolution HINT, never
   * written as the literal primary key, since it's an arbitrary
   * caller/AI-supplied string that may not fit this firm's LC-YYYY-NNN
   * numbering and could collide with it in confusing ways if inserted
   * directly.
   *
   * Returns { action: 'create'|'update', matchedBy: 'id'|'name'|null, case }.
   */
  static async resolveAndApply(tenantId, actingUser, { caseId, payload = {} } = {}) {
    const resolution = await this.resolveCaseIdentity(tenantId, { caseId, caseName: payload.case_name });

    if (resolution.case) {
      const updated = await this.applyFieldUpdate(tenantId, resolution.case.id, payload);
      if (actingUser) {
        await db.insertAuditLog({
          firmId: tenantId,
          userId: actingUser.id,
          action: 'COPILOT_UPDATE_CASE',
          details: { case_id: resolution.case.id, matched_by: resolution.matchedBy, payload }
        });
      }
      return { action: 'update', matchedBy: resolution.matchedBy, case: updated };
    }

    // No existing case matched — only create one if there's enough
    // information to (a real case needs at least a name and a client).
    if (!payload.case_name || !payload.case_name.trim() || !payload.client_name || !payload.client_name.trim()) {
      const err = new Error(
        `No case matches "${caseId}"${payload.case_name ? ` or the name "${payload.case_name}"` : ''}, and there isn't ` +
        'enough information to create one — both case_name and client_name are required to create a new case.'
      );
      err.status = 404;
      err.code = 'CASE_NOT_FOUND';
      throw err;
    }

    try {
      const created = await this.createCase(tenantId, actingUser, {
        title: payload.case_name,
        client: payload.client_name,
        opposingParty: payload.opposing_party,
        opposingCounsel: payload.opposing_counsel,
        area: payload.case_type,
        attorney: payload.lead_attorney,
        status: payload.status,
        hearing: null
      }, 'COPILOT_CREATE_CASE');
      return { action: 'create', matchedBy: null, case: created };
    } catch (err) {
      // A second request could have created a matching case between our
      // resolution check above and this insert (createCase's next-id
      // computation isn't a locked sequence — two concurrent callers can
      // compute the same next id and race on it). Postgres' unique
      // constraint on cases.id rejects the loser with 23505; re-resolve
      // and fall through to updating the winner's row instead of
      // surfacing a raw database error for what is, from the caller's
      // perspective, a completely reasonable "someone else just created
      // this" outcome.
      if (err.code === '23505') {
        const retry = await this.resolveCaseIdentity(tenantId, { caseId, caseName: payload.case_name });
        if (retry.case) {
          const updated = await this.applyFieldUpdate(tenantId, retry.case.id, payload);
          return { action: 'update', matchedBy: retry.matchedBy, case: updated };
        }
      }
      throw err;
    }
  }

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
   * POST /api/v1/cases/:id/documents — lets a client (or staff) upload a
   * document straight to one of their own cases, rather than the portal
   * being read-only. Ownership is verified exactly like getCase()/
   * getCaseDocuments() before any upload work happens. Delegates the
   * actual file handling (quota/ClamAV already ran as route middleware —
   * see server/routes/api.js) to VaultService.initiateUpload, then writes
   * its own audit log entry with the new document's real UUID rather than
   * relying on the generic logAuditAction middleware: that middleware
   * falls back to `req.params.id` for the document id, which on this
   * route is the CASE id (e.g. "LC-2026-001") — not a UUID, and
   * document_id is a UUID FK, so that fallback would fail the insert the
   * same way the pre-existing CREATE_CASE/ARCHIVE_CASE audit entries had
   * to route around it (see this file's header comment).
   */
  static async uploadCaseDocument(tenantId, user, caseId, file) {
    const caseRow = await db.getCaseByIdForUser(tenantId, caseId, user);
    if (!caseRow) throw notFound();

    const { document } = await VaultService.initiateUpload(tenantId, user.id, file, { case_id: caseId });

    await db.insertAuditLog({
      firmId: tenantId,
      userId: user.id,
      documentId: document.id,
      action: 'UPLOAD',
      details: { case_id: caseId, uploaded_via: user.role === 'CLIENT' ? 'client_portal' : 'staff' }
    });

    return document;
  }

  /**
   * GET /api/v1/cases/:id/deadlines — the client portal's expanded hearing
   * schedule (every case_deadlines row for this case, not just the single
   * "next hearing" toCaseView summarizes). Ownership is verified the same
   * way getCase()/getCaseDocuments() verify it.
   */
  static async getCaseDeadlines(tenantId, caseId, user) {
    const caseRow = await db.getCaseByIdForUser(tenantId, caseId, user);
    if (!caseRow) throw notFound();
    const rows = await db.listDeadlinesByCase(tenantId, caseId);
    const today = new Date().toISOString().slice(0, 10);
    return rows.map(r => ({
      id: r.id,
      title: r.title,
      location: r.location,
      date: r.deadline_date,
      dateFormatted: formatHearingDate(r.deadline_date),
      timeText: r.time_text,
      badgeType: r.badge_type,
      status: deadlineStatus(r.deadline_date, r.badge_type, today)
    }));
  }

  /**
   * GET /api/v1/cases/:id/activity — the client portal's case timeline:
   * status/lifecycle changes, document uploads, AI Copilot actions, and
   * messages, all tied to this one case and merged into a single
   * chronological feed by db.listActivityForCase. Ownership is verified
   * the same way every other case sub-resource here verifies it.
   */
  static async getCaseActivity(tenantId, caseId, user) {
    const caseRow = await db.getCaseByIdForUser(tenantId, caseId, user);
    if (!caseRow) throw notFound();
    const rows = await db.listActivityForCase(tenantId, caseId, isStaff(user));
    return rows.map(toActivityView);
  }

  /**
   * GET /api/v1/cases/:id/documents — the client portal's document list.
   * Ownership is verified the same way getCase() verifies it (a CLIENT
   * gets a 404, not the document list, if the case isn't theirs) before
   * ever touching the documents table.
   */
  static async getCaseDocuments(tenantId, caseId, user) {
    const caseRow = await db.getCaseByIdForUser(tenantId, caseId, user);
    if (!caseRow) throw notFound();
    const docs = await db.listDocumentsByCase(tenantId, caseId);
    return docs.map(d => ({
      id: d.id,
      file_name: d.file_name,
      extension: d.extension,
      file_size_bytes: d.file_size_bytes,
      category: d.category,
      author_name: d.author_name,
      is_flagged: d.is_flagged,
      created_at: d.created_at,
      updated_at: d.updated_at
    }));
  }

  /**
   * POST /api/v1/cases — create a new case, from either the "New Case"
   * modal or (via resolveAndApply) the AI Copilot when no existing case
   * matched. `attorney` arrives as the shorthand shown in the form's
   * select (e.g. "Sarah J.") — matched back to a real user id so the case
   * has a proper FK, not just a display string. Unlike applyFieldUpdate,
   * an unresolvable attorney here is NOT a hard error — a brand-new case
   * with no lead attorney assigned yet is a normal, valid state; failing
   * to REASSIGN an existing case's attorney is the dangerous silent
   * failure (see applyFieldUpdate).
   *
   * `auditAction` lets a caller other than the plain case-create API
   * (namely the Copilot) attribute the audit log entry accurately —
   * defaults to the human-UI action name.
   *
   * Before the case is inserted, ConflictCheckService compares its parties
   * (client, opposing party/counsel, related entities) against the firm's
   * existing case history. A hit does NOT silently block creation —
   * simple normalized-name matching produces false positives — but it does
   * stop this call short of inserting anything: the caller gets a 409 with
   * the matches attached (see err.conflicts) so the UI can show them, and
   * must resubmit with `conflictOverride: true` plus a non-empty
   * `conflictOverrideReason` to actually create the case. Every check
   * (clear, hit, or override) is logged via the audit log, per the
   * existing convention of stashing case-scoped info in `details` JSONB
   * rather than a `case_id` column (audit_logs has none).
   */
  static async createCase(tenantId, actingUser, payload = {}, auditAction = 'CREATE_CASE') {
    const {
      title, client, opposingParty, opposingCounsel, area, attorney, status, hearing, description,
      relatedEntities, conflictOverride, conflictOverrideReason
    } = payload;

    if (!title || !title.trim() || !client || !client.trim()) {
      const err = new Error('Case title and client name are required.');
      err.status = 400;
      throw err;
    }

    if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
      const err = new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}.`);
      err.status = 400;
      throw err;
    }

    const cleanRelatedEntities = Array.isArray(relatedEntities)
      ? relatedEntities.map(e => (e || '').trim()).filter(Boolean)
      : [];

    const matchedAttorney = await this.resolveAttorneyByShorthand(tenantId, attorney);

    const year = new Date().getFullYear();
    const maxNum = await db.getMaxCaseNumber(tenantId);
    const id = `LC-${year}-${String(maxNum + 1).padStart(3, '0')}`;

    const { matches } = await ConflictCheckService.checkConflicts(tenantId, {
      client: client.trim(),
      opposingParty: opposingParty || null,
      opposingCounsel: opposingCounsel || null,
      relatedEntities: cleanRelatedEntities
    });

    if (matches.length && !conflictOverride) {
      await db.insertAuditLog({
        firmId: tenantId,
        userId: actingUser ? actingUser.id : null,
        action: 'CONFLICT_CHECK_HIT',
        details: { case_id: id, case_name: title.trim(), matches }
      });

      const err = new Error(
        `Potential conflict of interest found against ${matches.length} existing case${matches.length === 1 ? '' : 's'}. ` +
        'Review the matches and resubmit with an explicit override to proceed.'
      );
      err.status = 409;
      err.code = 'CONFLICT_CHECK_HIT';
      err.conflicts = matches;
      throw err;
    }

    if (matches.length && conflictOverride) {
      if (!conflictOverrideReason || !conflictOverrideReason.trim()) {
        const err = new Error('An override reason is required to proceed past a conflict check hit.');
        err.status = 400;
        throw err;
      }
      await db.insertAuditLog({
        firmId: tenantId,
        userId: actingUser ? actingUser.id : null,
        action: 'CONFLICT_CHECK_OVERRIDE',
        details: { case_id: id, case_name: title.trim(), matches, overrideReason: conflictOverrideReason.trim() }
      });
    }

    if (!matches.length) {
      await db.insertAuditLog({
        firmId: tenantId,
        userId: actingUser ? actingUser.id : null,
        action: 'CONFLICT_CHECK_CLEAR',
        details: { case_id: id, case_name: title.trim() }
      });
    }

    await db.insertCase({
      id,
      firmId: tenantId,
      caseName: title.trim(),
      clientName: client.trim(),
      opposingParty: opposingParty || null,
      opposingCounsel: opposingCounsel || null,
      status: status || 'active',
      leadAttorneyId: matchedAttorney ? matchedAttorney.id : null,
      caseType: area || null,
      description: description || null,
      relatedEntities: cleanRelatedEntities
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
      action: auditAction,
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

CaseService.VALID_STATUSES = VALID_STATUSES;

module.exports = CaseService;
