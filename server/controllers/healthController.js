const { pool } = require('../db/pool');
const { clamAvIsRequired, pingClamAv } = require('../middleware/securityScanner');
const { messageEncryptionRequiresKms, getKeyProvider } = require('../services/encryption/keyProvider');

/**
 * GET /api/v1/health
 *
 * Public (mounted in server.js before authMiddleware is applied) — an
 * orchestrator/load balancer polling this can't authenticate, and
 * shouldn't need to. Checks the same dependencies server.js's start()
 * checks at boot, but reports a 503 instead of exiting the process, since
 * a request handler failing is not a reason to crash a running server.
 *
 * ClamAV and KMS connectivity are gated by the same "required outside
 * NODE_ENV=development" rule boot uses (see securityScanner.js /
 * keyProvider.js) — in development they report "skipped" rather than
 * being checked at all, matching boot's own no-op there.
 *
 * The KMS check (checkConnectivity) makes a real, billed AWS KMS API
 * call — not something to run on every single poll if something hits
 * this endpoint frequently. Both the ClamAV and KMS results are cached
 * for CACHE_TTL_MS so frequent polling doesn't hammer either dependency;
 * the database check is cheap (SELECT 1, no external cost) and always
 * runs fresh.
 */

const CACHE_TTL_MS = 15000;
let cache = { clamav: null, kms: null, expiresAt: 0 };

async function checkDatabase() {
  try {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

async function checkClamAv() {
  if (!clamAvIsRequired()) {
    return { status: 'skipped', reason: 'NODE_ENV=development' };
  }
  try {
    const reachable = await pingClamAv();
    return reachable
      ? { status: 'ok' }
      : { status: 'error', error: `ClamAV at ${process.env.CLAMAV_HOST}:${process.env.CLAMAV_PORT || 3310} did not respond to PING.` };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

async function checkKms() {
  if (!messageEncryptionRequiresKms()) {
    return { status: 'skipped', reason: 'NODE_ENV=development' };
  }
  try {
    await getKeyProvider().checkConnectivity();
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

async function getCachedChecks() {
  if (Date.now() < cache.expiresAt) {
    return { clamav: cache.clamav, kms: cache.kms };
  }
  const [clamav, kms] = await Promise.all([checkClamAv(), checkKms()]);
  cache = { clamav, kms, expiresAt: Date.now() + CACHE_TTL_MS };
  return { clamav, kms };
}

async function getHealth(req, res) {
  const [database, cached] = await Promise.all([checkDatabase(), getCachedChecks()]);
  const checks = { database, clamav: cached.clamav, kms: cached.kms };

  const allOk = Object.values(checks).every(c => c.status === 'ok' || c.status === 'skipped');
  const status = allOk ? 'ok' : 'error';

  res.status(allOk ? 200 : 503).json({
    success: allOk,
    data: { status, checks }
  });
}

module.exports = { getHealth };
