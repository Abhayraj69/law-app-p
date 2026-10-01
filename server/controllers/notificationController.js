const NotificationService = require('../services/notificationService');

/**
 * Notification Controller (Phase 6)
 * Validation/provider orchestration all live in NotificationService — see
 * its header comment. Role floors are applied at the route level
 * (server/routes/api.js).
 */

async function send(req, res, next) {
  try {
    const notification = await NotificationService.send(req.tenantId, req.user, req.body || {}, req.log);
    res.status(201).json({ success: true, data: notification });
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const notifications = await NotificationService.list(req.tenantId, req.query || {});
    res.json({ success: true, data: notifications });
  } catch (err) {
    next(err);
  }
}

module.exports = { send, list };
