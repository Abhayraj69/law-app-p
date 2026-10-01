const manualProvider = require('./providers/manualProvider');

/**
 * Picks the court-data backend a case sync is fetched through, the same
 * pluggable-provider shape server/services/esignature/providerSelector.js
 * and server/services/encryption/keyProvider.js already use: a provider is
 * a small object exposing `fetchCaseStatus({ cnrNumber, courtName })`, and
 * CourtSyncService never knows which one it's talking to. Only 'manual'
 * exists today (see providers/manualProvider.js) — set COURT_SYNC_PROVIDER
 * once a real, licensed vendor module (e.g. providers/kleopatraProvider.js)
 * is added here to swap it in without touching CourtSyncService itself.
 */
const PROVIDERS = { manual: manualProvider };

function getCourtSyncProvider() {
  const name = (process.env.COURT_SYNC_PROVIDER || 'manual').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown COURT_SYNC_PROVIDER "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

module.exports = { getCourtSyncProvider };
