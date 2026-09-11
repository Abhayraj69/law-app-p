const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

/**
 * Tests for the NODE_ENV-gated ClamAV requirement added to
 * server/middleware/securityScanner.js: the magic-byte-only fallback (no
 * live AV scan) must be allowed ONLY when NODE_ENV=development — anything
 * else (production, test, unset, a typo) must refuse both at boot
 * (checkClamAvRequirement) and per-upload (validateAndScanUpload, if the
 * scanner becomes unreachable sometime after a successful boot).
 *
 * Pure middleware/logic tests — no database needed, unlike the other
 * integration suites in this directory, so these always run.
 */

// Minimal mock of clamd's PING/INSTREAM protocol, spun up per-test on an
// ephemeral port so these tests don't depend on a real ClamAV install.
function startMockClamd({ respondToPing = true, foundOnSubstring = null } = {}) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const str = buf.toString('utf8');

        if (str.startsWith('zPING\0')) {
          if (respondToPing) socket.write('PONG\0');
          socket.end();
          return;
        }

        if (str.startsWith('zINSTREAM\0') && buf.length >= 14 && buf.slice(buf.length - 4).equals(Buffer.alloc(4))) {
          const found = foundOnSubstring && str.includes(foundOnSubstring);
          socket.write(found ? 'stream: Mock-Test-Signature FOUND\0' : 'stream: OK\0');
          socket.end();
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) saved[key] = process.env[key];
  Object.assign(process.env, overrides);
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

test('clamAvIsRequired: false only for NODE_ENV=development', async () => {
  const { clamAvIsRequired } = require('../middleware/securityScanner');
  await withEnv({ NODE_ENV: 'development' }, () => assert.equal(clamAvIsRequired(), false));
  await withEnv({ NODE_ENV: 'production' }, () => assert.equal(clamAvIsRequired(), true));
  await withEnv({ NODE_ENV: 'test' }, () => assert.equal(clamAvIsRequired(), true));
  await withEnv({ NODE_ENV: undefined }, () => {
    delete process.env.NODE_ENV;
    assert.equal(clamAvIsRequired(), true, 'an unset NODE_ENV must NOT be treated as an implicit development mode');
  });
});

test('checkClamAvRequirement: no-op in development even with no ClamAV configured at all', async () => {
  const { checkClamAvRequirement } = require('../middleware/securityScanner');
  await withEnv({ NODE_ENV: 'development', CLAMAV_HOST: '' }, async () => {
    delete process.env.CLAMAV_HOST;
    await assert.doesNotReject(() => checkClamAvRequirement());
  });
});

test('checkClamAvRequirement: throws outside development when CLAMAV_HOST is unset', async () => {
  const { checkClamAvRequirement } = require('../middleware/securityScanner');
  await withEnv({ NODE_ENV: 'production' }, async () => {
    delete process.env.CLAMAV_HOST;
    await assert.rejects(() => checkClamAvRequirement(), /requires a configured malware scanner/);
  });
});

test('checkClamAvRequirement: throws outside development when CLAMAV_HOST is set but unreachable', async () => {
  const { checkClamAvRequirement } = require('../middleware/securityScanner');
  await withEnv({ NODE_ENV: 'production', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: '1' }, async () => {
    await assert.rejects(() => checkClamAvRequirement(), /did not respond to PING/);
  });
});

test('checkClamAvRequirement: resolves outside development when ClamAV actually responds to PING', async () => {
  const { checkClamAvRequirement } = require('../middleware/securityScanner');
  const mockServer = await startMockClamd({ respondToPing: true });
  const port = mockServer.address().port;
  try {
    await withEnv({ NODE_ENV: 'production', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(port) }, async () => {
      await assert.doesNotReject(() => checkClamAvRequirement());
    });
  } finally {
    mockServer.close();
  }
});

test('validateAndScanUpload: refuses (503) outside development when no scanner is configured, even though signature checks pass', async () => {
  const { validateAndScanUpload } = require('../middleware/securityScanner');
  await withEnv({ NODE_ENV: 'production' }, async () => {
    delete process.env.CLAMAV_HOST;
    const req = { file: { originalname: 'doc.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 valid looking content') } };
    const res = mockRes();
    let nextCalled = false;
    await validateAndScanUpload(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, 'the upload must be blocked, not passed through to the route handler');
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'ANTIVIRUS_UNAVAILABLE');
  });
});

test('validateAndScanUpload: allows the magic-byte-only fallback in development when no scanner is configured', async () => {
  const { validateAndScanUpload } = require('../middleware/securityScanner');
  await withEnv({ NODE_ENV: 'development' }, async () => {
    delete process.env.CLAMAV_HOST;
    const req = { file: { originalname: 'doc.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 valid looking content') } };
    const res = mockRes();
    let nextCalled = false;
    await validateAndScanUpload(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true, 'development must be allowed to proceed without a live scanner');
    assert.equal(req.uploadValidation.antivirus_engine, 'none');
  });
});

test('validateAndScanUpload: still runs a real scan and blocks malware outside development when a scanner IS configured', async () => {
  const { validateAndScanUpload } = require('../middleware/securityScanner');
  const mockServer = await startMockClamd({ respondToPing: true, foundOnSubstring: 'MALWARE-MARKER' });
  const port = mockServer.address().port;
  try {
    await withEnv({ NODE_ENV: 'production', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(port) }, async () => {
      const req = { file: { originalname: 'doc.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 MALWARE-MARKER') } };
      const res = mockRes();
      let nextCalled = false;
      await validateAndScanUpload(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 422);
      assert.equal(res.body.code, 'MALWARE_DETECTED');
    });
  } finally {
    mockServer.close();
  }
});

test('validateAndScanUpload: passes a clean file outside development when the scanner confirms it clean', async () => {
  const { validateAndScanUpload } = require('../middleware/securityScanner');
  const mockServer = await startMockClamd({ respondToPing: true, foundOnSubstring: 'MALWARE-MARKER' });
  const port = mockServer.address().port;
  try {
    await withEnv({ NODE_ENV: 'production', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(port) }, async () => {
      const req = { file: { originalname: 'doc.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 perfectly normal content') } };
      const res = mockRes();
      let nextCalled = false;
      await validateAndScanUpload(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, true);
      assert.equal(req.uploadValidation.antivirus_engine, 'clamav');
      assert.equal(req.uploadValidation.antivirus_note, 'clean');
    });
  } finally {
    mockServer.close();
  }
});
