const db = require('../db');

/**
 * Audit Log Service
 * Backs the ADMIN-only Settings > Audit Log viewer. Every action already
 * gets written by server/middleware/auditLogger.js (document actions) or
 * directly via db.insertAuditLog (case/invoice/invite writes) — this is
 * the first thing that reads any of it back out.
 */

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function toLogView(row) {
  return {
    id: row.id,
    action: row.action,
    created_at: row.created_at,
    details: row.details,
    ip_address: row.ip_address,
    user_name: row.user_name,
    user_email: row.user_email,
    document_name: row.document_name
  };
}

class AuditLogService {
  /** GET /api/v1/admin/audit-logs — paginated, optionally filtered by user/action/date. */
  static async listAuditLogs(tenantId, query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.page_size, 10) || DEFAULT_PAGE_SIZE));

    const dateFrom = query.date_from || null;
    const dateTo = query.date_to || null;
    if (dateFrom && Number.isNaN(Date.parse(dateFrom))) throw badRequest('Invalid date_from.');
    if (dateTo && Number.isNaN(Date.parse(dateTo))) throw badRequest('Invalid date_to.');

    const filters = {
      userId: query.user_id || null,
      action: query.action || null,
      dateFrom,
      dateTo
    };

    const [rows, total] = await Promise.all([
      db.listAuditLogsForFirm(tenantId, filters, pageSize, (page - 1) * pageSize),
      db.countAuditLogsForFirm(tenantId, filters)
    ]);

    return {
      logs: rows.map(toLogView),
      page,
      page_size: pageSize,
      total
    };
  }
}

module.exports = AuditLogService;
