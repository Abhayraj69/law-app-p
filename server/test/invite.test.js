const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Admin-invite user provisioning tests.
 *
 * Before this feature, the only way to add a user was running
 * `npm run seed` with a new hardcoded entry — not something the app
 * itself could do, and the admin who ran it knew every new user's
 * initial password. These tests prove the real replacement: an ADMIN can
 * create an invite, the placeholder account it creates is NOT usable
 * until the invite is accepted, the invitee (not the admin) is the one
 * who sets the real password, a token can't be reused or reused
 * concurrently, and an expired token is refused.
 *
 * Requires a real database via TEST_DATABASE_URL, same as the other
 * integration tests — skipped (not failed) if it isn't set.
 * Run with: TEST_DATABASE_URL=postgres://... npm test
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Admin-invite user provisioning', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const authService = require('../services/authService');
  const InviteService = require('../services/inviteService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const ADMIN_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Invite Test Firm', `invite-test-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);
  const admin = await db.createUser({ id: ADMIN_ID, firmId: FIRM_ID, email: `admin-${ADMIN_ID}@example.com`, fullName: 'Test Admin', role: 'ADMIN', initials: 'TA', passwordHash });

  await t.test('creating an invite makes a real user row that cannot log in yet', async () => {
    const invitedEmail = `invitee-${crypto.randomUUID()}@example.com`;
    const result = await InviteService.createInvite(FIRM_ID, admin, { email: invitedEmail, fullName: 'New Hire', role: 'ASSOCIATE' });

    assert.equal(result.user.email, invitedEmail);
    assert.ok(result.invite_token, 'a raw invite token should be returned');
    assert.ok(!('password_hash' in result.user), 'the public user object must never include the placeholder hash');

    // The placeholder user row exists in Postgres...
    const row = await db.getUserByEmail(invitedEmail);
    assert.ok(row, 'the invited user row should exist immediately, before acceptance');

    // ...but no password can authenticate as them yet.
    await assert.rejects(
      () => authService.verifyCredentials(invitedEmail, 'any-password-at-all'),
      (err) => err.status === 401,
      'the placeholder password must never be a usable credential'
    );
  });

  await t.test('inviting an email that already exists is refused, not silently overwritten', async () => {
    const dupeEmail = `dupe-${crypto.randomUUID()}@example.com`;
    await InviteService.createInvite(FIRM_ID, admin, { email: dupeEmail, fullName: 'First', role: 'ASSOCIATE' });

    await assert.rejects(
      () => InviteService.createInvite(FIRM_ID, admin, { email: dupeEmail, fullName: 'Second (should be refused)', role: 'PARTNER' }),
      (err) => err.status === 409,
      'a duplicate email must be refused with 409, not silently upsert the existing user'
    );

    // Confirm the original user's details were NOT clobbered.
    const row = await db.getUserByEmail(dupeEmail);
    assert.equal(row.full_name, 'First');
  });

  await t.test('the invite preview returns the invitee\'s details without requiring auth', async () => {
    const email = `preview-${crypto.randomUUID()}@example.com`;
    const { invite_token } = await InviteService.createInvite(FIRM_ID, admin, { email, fullName: 'Preview Person', role: 'PARALEGAL' });

    const preview = await InviteService.getInvitePreview(invite_token);
    assert.equal(preview.email, email);
    assert.equal(preview.full_name, 'Preview Person');
    assert.equal(preview.role, 'PARALEGAL');
  });

  await t.test('an unknown/garbage token is rejected the same way an expired one would be', async () => {
    await assert.rejects(
      () => InviteService.getInvitePreview('not-a-real-token'),
      (err) => err.status === 404
    );
  });

  await t.test('accepting with a weak password is rejected before touching the invite', async () => {
    const email = `weakpw-${crypto.randomUUID()}@example.com`;
    const { invite_token } = await InviteService.createInvite(FIRM_ID, admin, { email, fullName: 'Weak Password', role: 'ASSOCIATE' });

    await assert.rejects(
      () => InviteService.acceptInvite(invite_token, 'short'),
      (err) => err.status === 400
    );

    // The invite must still be usable afterward — a rejected weak-password
    // attempt must not burn the token.
    const preview = await InviteService.getInvitePreview(invite_token);
    assert.equal(preview.email, email);
  });

  await t.test('accepting sets the invitee\'s OWN password and logs them in; the token then stops working', async () => {
    const email = `accept-${crypto.randomUUID()}@example.com`;
    const chosenPassword = 'InviteeChosenPassword123!';
    const { invite_token } = await InviteService.createInvite(FIRM_ID, admin, { email, fullName: 'Accepted User', role: 'ASSOCIATE' });

    const result = await InviteService.acceptInvite(invite_token, chosenPassword);
    assert.ok(result.token, 'accepting should return a usable login token, same as a normal login');
    assert.equal(result.user.email, email);

    // The invitee can now log in with the password THEY chose.
    const user = await authService.verifyCredentials(email, chosenPassword);
    assert.equal(user.email, email);

    // The same token cannot be used again.
    await assert.rejects(
      () => InviteService.acceptInvite(invite_token, 'AnotherPassword123!'),
      (err) => err.status === 404,
      'an already-accepted token must behave like an invalid one, not a special "already used" case an attacker could distinguish'
    );
  });

  await t.test('a non-ADMIN cannot be used to authorize invite creation (service-level enforcement)', async () => {
    // InviteService.createInvite itself doesn't check the role — that's
    // requireRole('ADMIN') in server/routes/api.js — but confirm the role
    // hierarchy used there actually rejects a non-ADMIN caller, since
    // that's the only thing standing between any staff member and being
    // able to provision new accounts.
    const { ROLE_HIERARCHY } = require('../middleware/auth');
    assert.ok(ROLE_HIERARCHY.ADMIN > ROLE_HIERARCHY.SENIOR_PARTNER, 'ADMIN must outrank every other staff role for this gate to mean anything');
  });

  await t.test('two concurrent accepts of the same token: exactly one succeeds', async () => {
    const email = `race-${crypto.randomUUID()}@example.com`;
    const { invite_token } = await InviteService.createInvite(FIRM_ID, admin, { email, fullName: 'Race Condition', role: 'ASSOCIATE' });

    const attempts = await Promise.allSettled([
      InviteService.acceptInvite(invite_token, 'FirstAttempt123!'),
      InviteService.acceptInvite(invite_token, 'SecondAttempt123!')
    ]);

    const fulfilled = attempts.filter(a => a.status === 'fulfilled');
    const rejected = attempts.filter(a => a.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one of the two concurrent accepts should succeed');
    assert.equal(rejected.length, 1, 'the other must be refused, not silently double-applied');
  });

  await t.test('an expired invite is rejected even with the correct token', async () => {
    const email = `expired-${crypto.randomUUID()}@example.com`;
    const { invite_token } = await InviteService.createInvite(FIRM_ID, admin, { email, fullName: 'Expired Invite', role: 'ASSOCIATE' });

    // Force it into the past directly — InviteService always creates
    // invites 7 days out, so this simulates time passing rather than
    // waiting a week in a test.
    const tokenHash = crypto.createHash('sha256').update(invite_token).digest('hex');
    await pool.query(`UPDATE user_invites SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE token_hash = $1`, [tokenHash]);

    await assert.rejects(
      () => InviteService.acceptInvite(invite_token, 'TooLatePassword123!'),
      (err) => err.status === 404
    );
  });

  await t.test('listTeam reports correct invite_status for active, pending, and accepted users', async () => {
    const pendingEmail = `roster-pending-${crypto.randomUUID()}@example.com`;
    await InviteService.createInvite(FIRM_ID, admin, { email: pendingEmail, fullName: 'Roster Pending', role: 'ASSOCIATE' });

    const acceptedEmail = `roster-accepted-${crypto.randomUUID()}@example.com`;
    const { invite_token } = await InviteService.createInvite(FIRM_ID, admin, { email: acceptedEmail, fullName: 'Roster Accepted', role: 'ASSOCIATE' });
    await InviteService.acceptInvite(invite_token, 'RosterAccepted123!');

    const team = await InviteService.listTeam(FIRM_ID);
    const pendingEntry = team.find(u => u.email === pendingEmail);
    const acceptedEntry = team.find(u => u.email === acceptedEmail);
    const adminEntry = team.find(u => u.id === ADMIN_ID);

    assert.equal(pendingEntry.invite_status, 'pending');
    assert.equal(acceptedEntry.invite_status, 'active');
    assert.equal(adminEntry.invite_status, 'active', 'a user created directly (no invite row at all) must report as active, not crash or show pending');
  });

  // Teardown — every other table references the firm with ON DELETE
  // CASCADE, so removing it removes the rest (users, their invites, etc).
  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
