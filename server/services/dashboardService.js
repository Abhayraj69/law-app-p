const db = require('../db');
const IntegrationService = require('./integrationService');

/**
 * Dashboard Service
 * Backs the Dashboard Overview page with a SINGLE aggregating endpoint
 * (GET /api/v1/dashboard/summary) so the client makes one request instead
 * of the N separate calls the KPI cards, hearings list, message list,
 * billing chart, and activity feed would otherwise need. Replaces the
 * hardcoded CASES/HEARINGS/MESSAGES/BILLING_DATA/ACTIVITIES/NOTIFICATIONS
 * arrays that used to live in app.js.
 *
 * KNOWN LIMITATION: the case/document/message counts in getDashboardCounts
 * are role-scoped (a CLIENT only ever sees their own cases' numbers), but
 * the hearings widget (case_deadlines) and the client-messages widget
 * (client_messages) are firm-wide — those two tables have no per-client
 * ownership column in the schema, matching how they already behaved for
 * every other page in this app before this change. This page is built for
 * firm staff, not as a client-facing portal; flagged in README.md rather
 * than silently pretending those two widgets are client-scoped.
 */

function formatCurrencyCents(cents) {
  return Math.round(cents / 100);
}

const ACTIVITY_ICON_BY_ACTION = {
  UPLOAD: 'doc',
  UPDATE_METADATA: 'doc',
  FLAG: 'alert',
  UNFLAG: 'doc',
  SHARE: 'msg',
  DELETE: 'doc',
  CREATE_FOLDER: 'case',
  COPILOT_MOVE: 'doc',
  COPILOT_RENAME: 'doc',
  COPILOT_TAG: 'doc',
  COPILOT_DELETE: 'doc',
  COPILOT_UPDATE_CASE: 'case'
};

const ACTIVITY_LABEL_BY_ACTION = {
  UPLOAD: 'New document uploaded',
  UPDATE_METADATA: 'Document updated',
  FLAG: 'Document flagged for review',
  UNFLAG: 'Document unflagged',
  SHARE: 'Document shared',
  DELETE: 'Document deleted',
  CREATE_FOLDER: 'Folder created',
  COPILOT_MOVE: 'AI Copilot moved a document',
  COPILOT_RENAME: 'AI Copilot renamed a document',
  COPILOT_TAG: 'AI Copilot tagged a document',
  COPILOT_DELETE: 'AI Copilot deleted a document',
  COPILOT_UPDATE_CASE: 'AI Copilot updated a case'
};

// Same "everyone except CLIENT" rule caseService.js/communicationsService.js
// apply elsewhere — the three Phase 1 ops metrics below (listed this week,
// non-updated after hearing, awaiting draft) are internal practice-ops
// numbers, not something a client's dashboard should show.
function isStaff(user) {
  return !!user && user.role !== 'CLIENT';
}

function relativeTime(date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  return `${diffDay} days ago`;
}

function toActivityView(row) {
  const userName = row.user_name || 'Someone';
  const target = row.document_name ? `<strong>${row.document_name}</strong>` : (row.case_name ? `<strong>${row.case_name}</strong>` : '');
  const label = ACTIVITY_LABEL_BY_ACTION[row.action] || row.action;
  return {
    icon: ACTIVITY_ICON_BY_ACTION[row.action] || 'doc',
    text: `<strong>${label}</strong>${target ? ' – ' + target : ''} (${userName})`,
    time: relativeTime(row.created_at)
  };
}

class DashboardService {
  static async getSummary(tenantId, user) {
    const staff = isStaff(user);

    const [counts, billingData, invoiceStats, deadlines, messages, activity, ops] = await Promise.all([
      db.getDashboardCounts(tenantId, user),
      db.getMonthlyBillingTotals(tenantId),
      db.getInvoiceStats(tenantId),
      IntegrationService.getDeadlines(tenantId),
      IntegrationService.getFlaggedMessages(tenantId),
      db.listRecentAuditActivity(tenantId, 6),
      // Phase 1 ops metrics — skipped entirely (not just hidden) for a
      // CLIENT viewer, same posture as the case/document/message counts in
      // getDashboardCounts already take for anything client-sensitive.
      staff
        ? Promise.all([
            db.getHearingsListedThisWeekCount(tenantId),
            db.getHearingsNotUpdatedCount(tenantId),
            db.getTasksAwaitingDraftCount(tenantId)
          ])
        : Promise.resolve(null)
    ]);

    return {
      kpis: {
        active_cases: counts.active_cases,
        pending_documents: counts.pending_documents,
        unread_messages: counts.unread_messages,
        revenue_ytd: formatCurrencyCents(invoiceStats.revenue_ytd_cents),
        overdue_invoices_count: invoiceStats.overdue_count,
        overdue_invoices_amount: formatCurrencyCents(invoiceStats.overdue_cents)
      },
      billing_chart: billingData.map(b => ({ month: b.month, value: formatCurrencyCents(b.value) })),
      hearings: (deadlines.upcoming || []).slice(0, 5).map(d => ({
        day: new Date(d.deadline_date).getUTCDate(),
        month: new Date(d.deadline_date).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
        case: d.title,
        time: d.time_text,
        room: d.location,
        type: d.badge_type === 'Filing' ? 'deadline' : (d.badge_type === 'Trial' ? 'urgent' : 'normal'),
        fullDate: d.deadline_date
      })),
      messages: messages.slice(0, 5).map(m => ({
        initials: m.client_avatar,
        name: m.client_name,
        preview: m.preview,
        time: m.timestamp_text,
        unread: m.is_unread ? 1 : 0,
        unreadItem: m.is_unread
      })),
      activity: activity.map(toActivityView),
      // null for a CLIENT viewer — see the staff ? ... : null above —
      // rather than a fake all-zero object, so the frontend can tell
      // "not applicable to you" apart from "genuinely zero right now".
      ops: ops ? {
        listed_this_week: ops[0],
        not_updated_after_hearing: ops[1],
        awaiting_draft: ops[2]
      } : null
    };
  }

  /**
   * GET /api/v1/analytics/management (Phase 6) — firm-level reporting
   * across cases, billing, and staff workload. Deliberately a separate
   * method/route from getSummary/dashboard-summary rather than folded into
   * it: this is a leadership view (gated PARTNER+ at the route level, see
   * server/routes/api.js), while the dashboard summary above is every
   * staff member's own landing page. Reuses this file's existing
   * "one aggregating request, several widgets" convention rather than a
   * parallel analytics service.
   */
  static async getManagementAnalytics(tenantId) {
    const [caseStatus, caseType, billingData, invoiceStats, workload] = await Promise.all([
      db.getCaseStatusBreakdown(tenantId),
      db.getCaseTypeBreakdown(tenantId),
      db.getMonthlyBillingTotals(tenantId),
      db.getInvoiceStats(tenantId),
      db.getStaffWorkload(tenantId)
    ]);

    return {
      cases_by_status: caseStatus.map(r => ({ status: r.status, count: r.count })),
      cases_by_type: caseType.map(r => ({ case_type: r.case_type, count: r.count })),
      billing_chart: billingData.map(b => ({ month: b.month, value: formatCurrencyCents(b.value) })),
      billing: {
        revenue_ytd: formatCurrencyCents(invoiceStats.revenue_ytd_cents),
        overdue_invoices_count: invoiceStats.overdue_count,
        overdue_invoices_amount: formatCurrencyCents(invoiceStats.overdue_cents)
      },
      staff_workload: workload.map(w => ({
        user_id: w.id,
        full_name: w.full_name,
        role: w.role,
        open_tasks: w.open_tasks,
        // Stored in minutes (time_entries.minutes); rounded to one decimal
        // hour for a reporting view, the same formatCurrencyCents-style
        // "store precisely, present rounded" split this file already uses.
        hours_this_month: Math.round((w.minutes_this_month / 60) * 10) / 10
      }))
    };
  }
}

module.exports = DashboardService;
