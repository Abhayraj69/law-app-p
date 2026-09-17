const InviteService = require('../services/inviteService');

/**
 * Invite Controller
 * ADMIN-gated user provisioning (createInvite, listTeam) plus the two
 * public endpoints an invitee hits before they have any account to
 * authenticate with (getInvitePreview, acceptInvite) — see
 * server/routes/auth.js for why those two are mounted outside authMiddleware.
 */

async function createInvite(req, res, next) {
  try {
    const result = await InviteService.createInvite(req.tenantId, req.user, req.body || {});
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function listTeam(req, res, next) {
  try {
    const team = await InviteService.listTeam(req.tenantId);
    res.json({ success: true, data: team });
  } catch (err) {
    next(err);
  }
}

async function getInvitePreview(req, res, next) {
  try {
    const preview = await InviteService.getInvitePreview(req.params.token);
    res.json({ success: true, data: preview });
  } catch (err) {
    next(err);
  }
}

async function acceptInvite(req, res, next) {
  try {
    const { password } = req.body || {};
    const result = await InviteService.acceptInvite(req.params.token, password);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/admin/users/:id/revoke-sessions — ADMIN-gated.
 *
 * The departing-employee case: signs a user out of every device at once,
 * without deleting their account (which would take their audit trail and
 * document authorship with it). Takes effect on that user's very next
 * request, not whenever their 12-hour token happens to expire.
 */
async function revokeUserSessions(req, res, next) {
  try {
    const result = await InviteService.revokeUserSessions(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { createInvite, listTeam, getInvitePreview, acceptInvite, revokeUserSessions };
