const db = require('../db');
const CaseService = require('./caseService');
const baseLogger = require('../utils/logger');
const notificationProviderSelector = require('./notifications/providerSelector');

/**
 * Notification Service — Phase 6
 *
 * Sends (or, today, logs — see providers/logProvider.js) a message to a
 * user over email/SMS/WhatsApp through a pluggable adapter
 * (server/services/notifications/providerSelector.js). Every attempt,
 * delivered or not, is written to notification_log — see
 * 0031_notifications.sql for why this is a deliberately explicit,
 * staff-triggered action rather than an automatic side effect of task/
 * hearing creation.
 *
 * Referenced as a module object, not destructured, so tests can
 * monkey-patch notificationProviderSelector.getNotificationProvider the
 * same way courtSyncService's tests monkey-patch its own selector.
 */

const VALID_CHANNELS = ['email', 'sms', 'whatsapp'];

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function notFound(what) {
  const err = new Error(`${what} not found.`);
  err.status = 404;
  return err;
}

function toNotificationView(row) {
  return {
    id: row.id,
    recipient_user_id: row.recipient_user_id,
    recipient_name: row.recipient_name || null,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    provider: row.provider,
    status: row.status,
    error_message: row.error_message,
    case_id: row.case_id,
    case_name: row.case_name || null,
    task_id: row.task_id,
    hearing_id: row.hearing_id,
    sent_by_name: row.sent_by_name || null,
    created_at: row.created_at
  };
}

// A channel's delivery address, as far as this app currently has one
// stored. There is no phone-number column on `users` yet — SMS/WhatsApp
// have nowhere real to deliver to until a vendor integration adds one, so
// `to` is null for those channels today; the log provider doesn't need a
// real address anyway (see its own comment).
function resolveAddress(channel, user) {
  if (channel === 'email') return user.email;
  return null;
}

class NotificationService {
  static get VALID_CHANNELS() {
    return VALID_CHANNELS;
  }

  /**
   * POST /api/v1/notifications/send — an explicit, staff-triggered send.
   * case_id/task_id/hearing_id are optional context for the log entry
   * (e.g. "notify this task's assignee"), not requirements.
   */
  static async send(tenantId, actingUser, payload = {}, log = baseLogger) {
    const { user_id, channel, subject, body, case_id, task_id, hearing_id } = payload;

    if (!user_id) throw badRequest('user_id is required.');
    if (!VALID_CHANNELS.includes(channel)) {
      throw badRequest(`channel must be one of: ${VALID_CHANNELS.join(', ')}.`);
    }
    if (!body || !String(body).trim()) throw badRequest('body is required.');

    const recipient = await db.getUserByIdAndFirm(user_id, tenantId);
    if (!recipient) throw notFound('Recipient user');

    if (case_id) await CaseService.getCase(tenantId, case_id, actingUser); // throws 404 if not visible

    const provider = notificationProviderSelector.getNotificationProvider();
    let status = 'failed';
    let errorMessage = null;

    try {
      const result = await provider.send(
        { channel, to: resolveAddress(channel, recipient), subject: subject || null, body: String(body).trim() },
        log
      );
      status = result.delivered ? 'sent' : 'logged';
    } catch (err) {
      status = 'failed';
      errorMessage = err.message;
    }

    const row = await db.insertNotificationLog({
      firmId: tenantId, recipientUserId: recipient.id, channel, subject: subject || null, body: String(body).trim(),
      provider: provider.name, status, errorMessage, caseId: case_id || null, taskId: task_id || null,
      hearingId: hearing_id || null, sentByUserId: actingUser.id
    });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'SEND_NOTIFICATION',
      details: { notification_id: row.id, recipient_user_id: recipient.id, channel, status }
    });

    return toNotificationView(row);
  }

  /** GET /api/v1/notifications — firm-wide, optionally filtered. */
  static async list(tenantId, filters = {}) {
    const rows = await db.listNotificationsForFirm(tenantId, {
      caseId: filters.case_id, taskId: filters.task_id, recipientUserId: filters.user_id
    });
    return rows.map(toNotificationView);
  }
}

module.exports = NotificationService;
