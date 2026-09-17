const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Tests for server/middleware/requestContext.js — the middleware that
 * gives every request a request id, a correlated logger, and an
 * access-log line on completion. Pure unit tests against a stubbed
 * req/res (same minimal-mock pattern as copilotRoleGating.test.js); no
 * database is touched by this middleware at all, so no TEST_DATABASE_URL
 * gate is needed here.
 */

const requestContext = require('../middleware/requestContext');

function fakeReq(overrides = {}) {
  return { method: 'GET', originalUrl: '/api/v1/cases', ...overrides };
}

function fakeRes() {
  const listeners = {};
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    on(event, cb) { listeners[event] = cb; },
    // Test helper, not part of the real Express API: fires whatever was
    // registered for res.on('finish', ...), the way Express itself would
    // once the response is actually sent.
    _triggerFinish() { if (listeners.finish) listeners.finish(); }
  };
}

// Forces JSON-mode output (server/utils/logger.js emits pretty, non-JSON
// text when NODE_ENV=development) so the JSON.parse assertions below are
// valid regardless of what NODE_ENV the test RUNNER happens to be started
// with — this suite is run standalone during development (no NODE_ENV set,
// defaults to JSON mode) and as part of the full suite (where the test
// harness sets NODE_ENV=development for every file, since that's what the
// app itself needs at boot) — both must produce the same, correctly
// asserted output here.
function captureOutput(fn) {
  const lines = [];
  const orig = process.stdout.write;
  const savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { fn(); } finally {
    process.stdout.write = orig;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  }
  return lines;
}

test('requestContext middleware', async (t) => {
  await t.test('assigns a request id and calls next()', () => {
    const req = fakeReq();
    const res = fakeRes();
    let nextCalled = false;
    requestContext(req, res, () => { nextCalled = true; });

    assert.ok(nextCalled, 'must call next() so the request pipeline continues');
    assert.ok(req.requestId, 'req.requestId must be set');
    assert.match(req.requestId, /^[0-9a-f-]{36}$/i, 'must be a real UUID, not a placeholder string');
  });

  await t.test('two different requests get two different request ids', () => {
    const req1 = fakeReq(); const res1 = fakeRes();
    const req2 = fakeReq(); const res2 = fakeRes();
    requestContext(req1, res1, () => {});
    requestContext(req2, res2, () => {});
    assert.notEqual(req1.requestId, req2.requestId);
  });

  await t.test('sets the X-Request-Id response header to the same id', () => {
    const req = fakeReq();
    const res = fakeRes();
    requestContext(req, res, () => {});
    assert.equal(res.headers['X-Request-Id'], req.requestId);
  });

  await t.test('req.log is usable and every line it writes carries the request id', () => {
    const req = fakeReq();
    const res = fakeRes();
    requestContext(req, res, () => {});

    const lines = captureOutput(() => {
      req.log.info('handler-level log line');
    });
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.request_id, req.requestId);
    assert.equal(parsed.context, 'HTTP');
  });

  await t.test('writes exactly one access-log line when the response finishes, with method/path/status/duration', () => {
    const req = fakeReq({ method: 'POST', originalUrl: '/api/v1/cases' });
    const res = fakeRes();
    res.statusCode = 201;
    requestContext(req, res, () => {});

    const lines = captureOutput(() => {
      res._triggerFinish();
    });
    assert.equal(lines.length, 1, 'exactly one access-log line per completed request');
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.method, 'POST');
    assert.equal(parsed.path, '/api/v1/cases');
    assert.equal(parsed.status, 201);
    assert.equal(typeof parsed.duration_ms, 'number');
    assert.ok(parsed.duration_ms >= 0);
    assert.equal(parsed.request_id, req.requestId, 'the access-log line itself must be correlated too');
  });

  await t.test('a req.log reassigned by auth middleware later still gets used for the access-log line', () => {
    // Mirrors what server/middleware/auth.js's authMiddleware does after
    // resolving an identity: req.log = req.log.child({user_id, firm_id}).
    // The access-log listener captured res.on('finish', ...) BEFORE that
    // reassignment happens — it must still log through the enriched
    // logger, not a stale reference to the pre-auth one, or every
    // authenticated request's access-log line would silently lose its
    // user_id/firm_id correlation.
    const req = fakeReq();
    const res = fakeRes();
    requestContext(req, res, () => {});

    req.log = req.log.child({ user_id: 'user-1', firm_id: 'firm-1' });

    const lines = captureOutput(() => {
      res._triggerFinish();
    });
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.user_id, 'user-1', 'the access-log line must reflect the enriched logger, not the pre-auth one');
    assert.equal(parsed.firm_id, 'firm-1');
  });
});
