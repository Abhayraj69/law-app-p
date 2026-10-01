const db = require('../db');
// Referenced as a module object, not destructured, so tests can monkey-patch
// courtSyncProviderSelector.getCourtSyncProvider the same way matterAnalysis/
// draft tests monkey-patch aiProvider's methods on its own module object.
const courtSyncProviderSelector = require('./courtSync/providerSelector');

/**
 * Court Sync Service — Phase 5 (Karnataka HC + eCourts)
 *
 * Syncs a case's court status through a pluggable, licensed-vendor adapter
 * (server/services/courtSync/providerSelector.js) rather than scraping
 * public court portals — see 0026_court_sync.sql's header for why. Only a
 * 'manual' provider exists today (no vendor contract signed yet), so
 * syncCase() will 503 until COURT_SYNC_PROVIDER names a real one; staff use
 * overrideSync() to record a case's state by hand in the meantime.
 *
 * Ownership: a case has no per-client column of its own here either (same
 * reasoning as HearingService's assertCaseVisible) — every read/write goes
 * through db.getCaseByIdForUser first, so a CLIENT gets the same
 * 404-not-403 treatment, and staff callers see the case regardless of who
 * created it (route-level requireRole does the staff-vs-client gating).
 *
 * Manual-override controls: once a case is 'manual_override', syncCase()
 * refuses to run rather than silently clobbering the correction a staff
 * member made because the feed was wrong or stale — clearOverride() is the
 * explicit, auditable way to hand it back to the normal sync flow.
 */

const CAUSE_LIST_ALERT_LEAD_DAYS = 7;

function notFound() {
  const err = new Error('Case not found.');
  err.status = 404;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function conflict(message, code) {
  const err = new Error(message);
  err.status = 409;
  err.code = code;
  return err;
}

async function assertCaseVisible(tenantId, caseId, user) {
  const caseRow = await db.getCaseByIdForUser(tenantId, caseId, user);
  if (!caseRow) throw notFound();
  return caseRow;
}

// Normalizes whatever shape a provider (or a staff member, via
// overrideSync) hands in into the one shape court_synced_state always
// stores — the same "read back whole, one predictable shape" reasoning
// matter_analyses.content and drafts.content already follow.
function normalizeSyncedState(raw = {}) {
  return {
    stage: raw.stage ? String(raw.stage).trim() : null,
    next_hearing_date: raw.next_hearing_date || raw.nextHearingDate || null,
    last_order: raw.last_order || raw.lastOrder || null,
    cause_list_date: raw.cause_list_date || raw.causeListDate || null,
    recorded_at: new Date().toISOString()
  };
}

function toCourtSyncView(row) {
  return {
    case_id: row.id,
    cnr_number: row.cnr_number,
    court_name: row.court_name,
    court_sync_status: row.court_sync_status,
    court_synced_state: row.court_synced_state,
    court_sync_overridden_by_user_id: row.court_sync_overridden_by_user_id,
    court_sync_overridden_at: row.court_sync_overridden_at,
    court_sync_override_note: row.court_sync_override_note,
    cause_list_watch: row.cause_list_watch,
    // Computed, not stored — same "overdue" convention TaskService.toTaskView
    // uses: whether to alert staff depends on today's date, not a flag that
    // has to be kept in sync by a background job (there isn't one; see
    // reminderEngine.js's own note on why this app has none).
    on_upcoming_cause_list: isUpcoming(row.court_synced_state?.cause_list_date)
  };
}

function toSyncLogView(row) {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    synced_state: row.synced_state,
    error_message: row.error_message,
    triggered_by_name: row.triggered_by_name || null,
    created_at: row.created_at
  };
}

function isUpcoming(dateStr) {
  if (!dateStr) return false;
  const today = new Date().toISOString().slice(0, 10);
  const lead = new Date(`${today}T00:00:00Z`);
  lead.setUTCDate(lead.getUTCDate() + CAUSE_LIST_ALERT_LEAD_DAYS);
  return dateStr >= today && dateStr <= lead.toISOString().slice(0, 10);
}

class CourtSyncService {
  /** GET /api/v1/cases/:id/court-sync */
  static async getCourtSyncState(tenantId, caseId, user) {
    const caseRow = await assertCaseVisible(tenantId, caseId, user);
    return toCourtSyncView(caseRow);
  }

  /** GET /api/v1/cases/:id/court-sync/logs */
  static async listSyncLogs(tenantId, caseId, user) {
    await assertCaseVisible(tenantId, caseId, user);
    const rows = await db.listCourtSyncLogsForCase(tenantId, caseId);
    return rows.map(toSyncLogView);
  }

  /** GET /api/v1/court-sync/watchlist — firm-wide, for the dashboard panel. */
  static async listCauseListWatch(tenantId) {
    const rows = await db.listCasesOnCauseListWatch(tenantId);
    return rows.map(row => ({
      case_id: row.id,
      case_name: row.case_name,
      cnr_number: row.cnr_number,
      court_name: row.court_name,
      court_sync_status: row.court_sync_status,
      cause_list_date: row.court_synced_state?.cause_list_date || null,
      on_upcoming_cause_list: isUpcoming(row.court_synced_state?.cause_list_date)
    }));
  }

  /** PATCH /api/v1/cases/:id/court-sync/link — attaches the vendor identifiers. */
  static async linkCase(tenantId, actingUser, caseId, payload = {}) {
    const caseRow = await assertCaseVisible(tenantId, caseId, actingUser);
    const cnrNumber = payload.cnr_number && String(payload.cnr_number).trim();
    if (!cnrNumber) throw badRequest('cnr_number is required to link a case for court sync.');

    const row = await db.updateCaseFields(tenantId, caseId, {
      cnrNumber, courtName: payload.court_name ? String(payload.court_name).trim() : caseRow.court_name
    });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'LINK_COURT_CASE',
      details: { case_id: caseId, cnr_number: cnrNumber }
    });

    return toCourtSyncView(row);
  }

  /**
   * POST /api/v1/cases/:id/court-sync/sync — the real fetch, through
   * whichever provider COURT_SYNC_PROVIDER names. Every attempt, success or
   * failure, is written to court_sync_logs — see 0026_court_sync.sql.
   */
  static async syncCase(tenantId, actingUser, caseId, log) {
    const caseRow = await assertCaseVisible(tenantId, caseId, actingUser);
    if (!caseRow.cnr_number) {
      throw badRequest('Link this case to a CNR number before syncing.', 'NOT_LINKED');
    }
    if (caseRow.court_sync_status === 'manual_override') {
      throw conflict(
        'This case\'s court sync state was manually overridden — clear the override before syncing again.',
        'MANUAL_OVERRIDE_ACTIVE'
      );
    }

    const provider = courtSyncProviderSelector.getCourtSyncProvider();

    try {
      const raw = await provider.fetchCaseStatus({ cnrNumber: caseRow.cnr_number, courtName: caseRow.court_name }, log);
      const syncedState = normalizeSyncedState(raw);

      const row = await db.updateCaseFields(tenantId, caseId, {
        courtSyncedState: syncedState, courtSyncStatus: 'synced'
      });
      await db.insertCourtSyncLog({
        firmId: tenantId, caseId, provider: provider.name, status: 'success',
        syncedState, triggeredByUserId: actingUser.id
      });
      await db.insertAuditLog({
        firmId: tenantId, userId: actingUser.id, action: 'SYNC_COURT_CASE',
        details: { case_id: caseId, provider: provider.name, status: 'success' }
      });

      return toCourtSyncView(row);
    } catch (err) {
      await db.updateCaseFields(tenantId, caseId, { courtSyncStatus: 'error' });
      await db.insertCourtSyncLog({
        firmId: tenantId, caseId, provider: provider.name, status: 'error',
        errorMessage: err.message, triggeredByUserId: actingUser.id
      });
      await db.insertAuditLog({
        firmId: tenantId, userId: actingUser.id, action: 'SYNC_COURT_CASE',
        details: { case_id: caseId, provider: provider.name, status: 'error', error: err.message }
      });

      const svcErr = new Error(err.message || 'Court sync failed.');
      svcErr.status = err.code === 'COURT_SYNC_NOT_CONFIGURED' ? 503 : 502;
      svcErr.code = err.code || 'COURT_SYNC_FAILED';
      throw svcErr;
    }
  }

  /**
   * POST /api/v1/cases/:id/court-sync/override — staff corrects the synced
   * state by hand, e.g. the vendor feed is wrong or stale. Puts the case
   * into 'manual_override' so a subsequent syncCase() refuses to run until
   * clearOverride() is called.
   */
  static async overrideSync(tenantId, actingUser, caseId, payload = {}) {
    await assertCaseVisible(tenantId, caseId, actingUser);
    if (!payload.note || !String(payload.note).trim()) {
      throw badRequest('A note is required explaining the manual override.');
    }

    const syncedState = normalizeSyncedState(payload.synced_state || {});
    const note = String(payload.note).trim();

    const row = await db.updateCaseFields(tenantId, caseId, {
      courtSyncedState: syncedState,
      courtSyncStatus: 'manual_override',
      courtSyncOverriddenByUserId: actingUser.id,
      courtSyncOverriddenAt: new Date(),
      courtSyncOverrideNote: note
    });

    await db.insertCourtSyncLog({
      firmId: tenantId, caseId, provider: 'manual-override', status: 'manual_override',
      syncedState, triggeredByUserId: actingUser.id
    });
    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'OVERRIDE_COURT_SYNC',
      details: { case_id: caseId, note }
    });

    return toCourtSyncView(row);
  }

  /**
   * POST /api/v1/cases/:id/court-sync/clear-override — hands the case back
   * to the normal sync flow. The corrected state stays as the accepted
   * baseline; only the override markers are cleared.
   */
  static async clearOverride(tenantId, actingUser, caseId) {
    const caseRow = await assertCaseVisible(tenantId, caseId, actingUser);
    if (caseRow.court_sync_status !== 'manual_override') {
      throw conflict('This case is not currently under a manual override.', 'WRONG_STATE');
    }

    const row = await db.updateCaseFields(tenantId, caseId, {
      courtSyncStatus: 'synced',
      courtSyncOverriddenByUserId: null,
      courtSyncOverriddenAt: null,
      courtSyncOverrideNote: null
    });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'CLEAR_COURT_SYNC_OVERRIDE',
      details: { case_id: caseId }
    });

    return toCourtSyncView(row);
  }

  /** PATCH /api/v1/cases/:id/court-sync/watch — routine flagging, PARALEGAL floor. */
  static async setCauseListWatch(tenantId, actingUser, caseId, watch) {
    await assertCaseVisible(tenantId, caseId, actingUser);
    const row = await db.updateCaseFields(tenantId, caseId, { causeListWatch: !!watch });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'UPDATE_CAUSE_LIST_WATCH',
      details: { case_id: caseId, cause_list_watch: !!watch }
    });

    return toCourtSyncView(row);
  }
}

module.exports = CourtSyncService;
