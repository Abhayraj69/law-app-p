const localProvider = require('./providers/localProvider');

/**
 * Picks the e-signature backend a signature request is sent through, the
 * same pluggable-provider shape server/services/encryption/keyProvider.js
 * uses for AWS KMS vs. a local key: a provider is a small object exposing
 * `send(request)` / `void(request)`, and SignatureService never knows
 * which one it's talking to. Only 'local' exists today (see
 * providers/localProvider.js) — set SIGNATURE_PROVIDER once a real
 * provider module (e.g. providers/docusignProvider.js) is added here to
 * swap it in without touching SignatureService itself.
 */
const PROVIDERS = { local: localProvider };

function getSignatureProvider() {
  const name = (process.env.SIGNATURE_PROVIDER || 'local').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown SIGNATURE_PROVIDER "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

module.exports = { getSignatureProvider };
