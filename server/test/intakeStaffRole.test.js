const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_HIERARCHY, requireRole } = require('../middleware/auth');

/**
 * INTAKE_STAFF role hierarchy tests (Phase 6) — no database needed, pure
 * middleware behavior.
 *
 * Covers the exact property the roadmap asks for: INTAKE_STAFF can do
 * consultation intake work (gated at requireRole('INTAKE_STAFF')) but
 * must NOT gain access to routes still gated at requireRole('PARALEGAL')
 * (tasks, hearings, time tracking) just by existing as a role ranked above
 * CLIENT — and that PARALEGAL+ still passes an INTAKE_STAFF-gated route,
 * since requireRole is a >= check.
 */

function mockReqRes(role) {
  const req = { user: role ? { role } : null };
  let statusCode = null;
  let body = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; }
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next: () => { next(); }, getResult: () => ({ statusCode, body, nextCalled }) };
}

test('INTAKE_STAFF ranks below PARALEGAL, above CLIENT', () => {
  assert.ok(ROLE_HIERARCHY.INTAKE_STAFF > ROLE_HIERARCHY.CLIENT);
  assert.ok(ROLE_HIERARCHY.INTAKE_STAFF < ROLE_HIERARCHY.PARALEGAL);
});

test('requireRole(INTAKE_STAFF) admits INTAKE_STAFF', () => {
  const { req, res, next, getResult } = mockReqRes('INTAKE_STAFF');
  requireRole('INTAKE_STAFF')(req, res, next);
  assert.equal(getResult().nextCalled, true);
});

test('requireRole(INTAKE_STAFF) admits PARALEGAL and above (>= check)', () => {
  for (const role of ['PARALEGAL', 'ASSOCIATE', 'PARTNER', 'SENIOR_PARTNER', 'ADMIN']) {
    const { req, res, next, getResult } = mockReqRes(role);
    requireRole('INTAKE_STAFF')(req, res, next);
    assert.equal(getResult().nextCalled, true, `${role} should pass requireRole('INTAKE_STAFF')`);
  }
});

test('requireRole(INTAKE_STAFF) rejects CLIENT', () => {
  const { req, res, next, getResult } = mockReqRes('CLIENT');
  requireRole('INTAKE_STAFF')(req, res, next);
  const result = getResult();
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
});

test('requireRole(PARALEGAL) rejects INTAKE_STAFF — the whole point of ranking it separately', () => {
  const { req, res, next, getResult } = mockReqRes('INTAKE_STAFF');
  requireRole('PARALEGAL')(req, res, next);
  const result = getResult();
  assert.equal(result.nextCalled, false, 'INTAKE_STAFF must not gain PARALEGAL-gated routes (tasks, hearings, time tracking)');
  assert.equal(result.statusCode, 403);
});
