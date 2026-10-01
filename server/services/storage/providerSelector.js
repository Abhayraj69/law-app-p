const localProvider = require('./providers/localProvider');
const s3Provider = require('./providers/s3Provider');

/**
 * Picks the document-storage backend, the same pluggable-provider shape
 * this codebase already uses for e-signature (see
 * server/services/esignature/providerSelector.js) and the KMS key
 * provider: a provider is a small object exposing write/read/remove/exists,
 * and FileService never knows which one it's talking to.
 *
 * 'local' (the default) writes to STORAGE_ROOT on disk — correct for a
 * single instance with a persistent volume (T1). 'S3' shares files between
 * multiple instances (T2) — set STORAGE_PROVIDER=s3 and STORAGE_S3_BUCKET
 * once running more than one instance.
 */
const PROVIDERS = { local: localProvider, s3: s3Provider };

function getStorageProvider() {
  const name = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown STORAGE_PROVIDER "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

module.exports = { getStorageProvider };
