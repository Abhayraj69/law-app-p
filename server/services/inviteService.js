const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const authService = require('./authService');
const { validatePassword } = require('../utils/passwordPolicy');

/**
 * Invite Service
 *
 * The only way to provision a new user used to be running `npm run seed`
 * with a new hardcoded entry and restarting the process. This replaces
 * that for real usage with an admin-invite flow — the single-firm model
 * the brief specified (never open self-signup, never a second firm):
 * an ADMIN creates a placeholder user + a one-time invite link, and the
 * invitee sets their OWN password by visiting it. The admin never learns
 * or chooses the invitee's password, unlike the seed-script model.
 *
 * The raw invite token is returned to the admin exactly once, at creation
 * time — like a seed-script password, it is never stored in plaintext or
 * retrievable again afterward, only its SHA-256 hash (user_invites.token_hash).
 * There is no email/SMTP integration configured in this project (see
 * .env.local's commented-out EMAIL section), so the admin is responsible
 * for relaying the link to the invitee through whatever channel they use
 * today — this does not silently pretend to have sent an email.
 */

const INVITE_TTL_DAYS = 7;
const VALID_ROLES = ['PARTNER', 'SENIOR_PARTNER', 'ASSOCIATE', 'PARALEGAL', 'ADMIN', 'CLIENT'];

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function invalidOrExpiredError() {
  const err = new Error('This invite link is invalid or has expired.');
  err.status = 404;
  return err;
}

class InviteService {
  /**
   * POST /api/v1/admin/invites (ADMIN only)
   * Creates the placeholder user row + invite token in one call.
   */
  static async createInvite(tenantId, invitingUser, { email, fullName, role, initials }) {
    if (!email || !email.trim() || !fullName || !fullName.trim()) {
      const err = new Error('Email and full name are required.');
      err.status = 400;
      throw err;
    }

    const normalizedRole = (role || 'ASSOCIATE').toUpperCase();
    if (!VALID_ROLES.includes(normalizedRole)) {
      const err = new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
      err.status = 400;
      throw err;
    }

    // A random, never-revealed hash — this placeholder must never
    // successfully authenticate anyone; only accepting the invite (which
    // requires the token) replaces it with a password the invitee chose.
    const placeholderPasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);

    const user = await db.createInvitedUser({
      firmId: tenantId,
      email: email.trim().toLowerCase(),
      fullName: fullName.trim(),
      role: normalizedRole,
      initials: initials ? initials.trim().slice(0, 10) : null,
      placeholderPasswordHash
    });

    if (!user) {
      const err = new Error('A user with that email already exists.');
      err.status = 409;
      throw err;
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    await db.createUserInvite({
      firmId: tenantId,
      userId: user.id,
      invitedBy: invitingUser ? invitingUser.id : null,
      tokenHash: hashToken(rawToken),
      expiresAt
    });

    return {
      user: authService.toPublicUser(user),
      invite_token: rawToken,
      invite_path: `/accept-invite.html?token=${rawToken}`,
      expires_at: expiresAt.toISOString()
    };
  }

  /**
   * GET /api/v1/auth/invite/:token (public, no auth)
   * Lets the accept-invite page show "Welcome, <name>" before the
   * invitee has set a password / logged in at all.
   */
  static async getInvitePreview(rawToken) {
    const invite = await db.getUsableInviteByTokenHash(hashToken(rawToken));
    if (!invite) throw invalidOrExpiredError();
    return { email: invite.email, full_name: invite.full_name, role: invite.role };
  }

  /**
   * POST /api/v1/auth/invite/:token/accept (public, no auth)
   * Sets the invitee's own password and logs them straight in — same
   * response shape as a normal login, so the client can reuse Auth.setSession.
   */
  static async acceptInvite(rawToken, password) {
    const invite = await db.getUsableInviteByTokenHash(hashToken(rawToken));
    if (!invite) throw invalidOrExpiredError();

    const { valid, message } = validatePassword(password, [invite.email, invite.full_name]);
    if (!valid) {
      const err = new Error(message);
      err.status = 400;
      throw err;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const accepted = await db.acceptUserInvite(invite.id, invite.user_id, passwordHash);
    if (!accepted) {
      // Lost a race to another request accepting the same token — not the
      // same failure mode as "invalid token", so a different message.
      const err = new Error('This invite link has already been used.');
      err.status = 409;
      throw err;
    }

    const user = await db.getUserById(invite.user_id);
    const token = authService.issueToken(user);
    return { token, expires_in: authService.TOKEN_TTL, user: authService.toPublicUser(user) };
  }

  /** GET /api/v1/admin/users (ADMIN only) — the "Team Members" roster. */
  static async listTeam(tenantId) {
    const users = await db.listUsersWithInviteStatus(tenantId);
    return users.map(u => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      initials: u.initials,
      created_at: u.created_at,
      invite_status: u.invite_status // 'active' | 'pending' | 'expired'
    }));
  }
}

module.exports = InviteService;
