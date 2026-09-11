const crypto = require('crypto');
const db = require('../../db');
const cipher = require('./messageCipher');

/**
 * Local Key Provider — NOT for production use.
 *
 * Used only when NODE_ENV=development (enforced in keyProvider.js, not
 * here — this module doesn't know or care what environment it's running
 * in). No KMS, no network calls, no AWS account needed: a single master
 * key read from MESSAGE_ENCRYPTION_LOCAL_KEY wraps/unwraps data
 * encryption keys (DEKs) locally, using the exact same AES-256-GCM
 * primitives (messageCipher.js) that protect message bodies themselves.
 *
 * This still follows the same envelope-encryption SHAPE production does
 * (a wrapped DEK stored in `encryption_keys.wrapped_dek`, never a bare
 * key) so the rest of the encryption layer — and every test against
 * it — exercises the real read/write/rotate code paths, not a simplified
 * stand-in. Only the "master key" backend differs: a KMS master key
 * never leaves KMS, but this local master key is just an env var, which
 * is exactly why this provider is refused outside development.
 */

function getMasterKey() {
  const raw = process.env.MESSAGE_ENCRYPTION_LOCAL_KEY;
  if (!raw) {
    throw new Error(
      'MESSAGE_ENCRYPTION_LOCAL_KEY is not set. Generate one with: ' +
      `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" ` +
      'and set it in .env.local. This key is for local development only — never use it in ' +
      'production, and never commit it.'
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== cipher.KEY_LENGTH) {
    throw new Error(`MESSAGE_ENCRYPTION_LOCAL_KEY must decode to exactly ${cipher.KEY_LENGTH} bytes (got ${key.length}). Generate a new one — see the error above for how.`);
  }
  return key;
}

// A wrapped DEK is stored as one bytea blob: nonce (12) || authTag (16) || ciphertext.
// AWS KMS's wrapped blob (CiphertextBlob) is opaque and self-describing —
// this local equivalent needs its own trivial fixed-offset framing since
// messageCipher keeps nonce/tag/ciphertext as separate values.
function packWrappedDek({ nonce, authTag, ciphertext }) {
  return Buffer.concat([nonce, authTag, ciphertext]);
}

function unpackWrappedDek(blob) {
  const nonce = blob.subarray(0, cipher.IV_LENGTH);
  const authTag = blob.subarray(cipher.IV_LENGTH, cipher.IV_LENGTH + cipher.AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(cipher.IV_LENGTH + cipher.AUTH_TAG_LENGTH);
  return { nonce, authTag, ciphertext };
}

class LocalKeyProvider {
  constructor() {
    // In-process only — a decrypted DEK is never written to disk or logs.
    // Keyed by encryption_keys.id.
    this._dekCache = new Map();
  }

  async _wrapDek(keyId, dek) {
    const masterKey = getMasterKey();
    const { ciphertext, nonce, authTag } = cipher.encrypt({
      dek: masterKey,
      conversationId: 'local-key-wrap', // AAD context, not a real conversation — see messageCipher.buildAad
      messageId: keyId,
      plaintext: dek.toString('base64')
    });
    return packWrappedDek({ ciphertext, nonce, authTag });
  }

  _unwrapDek(keyId, wrappedBlob) {
    const masterKey = getMasterKey();
    const { nonce, authTag, ciphertext } = unpackWrappedDek(wrappedBlob);
    const base64Dek = cipher.decrypt({
      dek: masterKey,
      conversationId: 'local-key-wrap',
      messageId: keyId,
      ciphertext, nonce, authTag
    });
    return Buffer.from(base64Dek, 'base64');
  }

  /**
   * Mints a brand-new active DEK for this firm, retiring whatever was
   * active for it before. Keys are per (provider, firm) — see
   * db/migrations/0008_per_firm_encryption_keys.sql — so rotating one
   * firm's key never touches another firm's.
   */
  async rotateKey(firmId) {
    if (!firmId) throw new Error('rotateKey requires a firmId — encryption keys are scoped per firm.');
    await db.retireActiveEncryptionKeys('local', firmId);

    const keyId = crypto.randomUUID();
    const dek = cipher.generateDek();
    const wrapped = await this._wrapDek(keyId, dek);

    await db.insertEncryptionKey({ id: keyId, provider: 'local', firmId, kmsKeyArn: null, wrappedDek: wrapped });
    this._dekCache.set(keyId, dek);
    return { keyId, dek };
  }

  /**
   * Returns firmId's current active DEK, minting one on first use if none
   * exists yet. Two processes can both observe "no active key for this
   * firm" and race to mint the first one (there's no lock between the
   * read and the insert) — the database's partial unique index
   * (idx_one_active_key_per_provider_firm, db/migrations/0008) rejects
   * the loser's insert with a 23505, at which point the loser simply
   * reads back and uses the winner's key instead of erroring, the same
   * re-resolve-on-conflict pattern server/services/caseService.js's
   * resolveAndApply uses for a concurrent case-creation race.
   */
  async getActiveDek(firmId) {
    if (!firmId) throw new Error('getActiveDek requires a firmId — encryption keys are scoped per firm.');
    const active = await db.getActiveEncryptionKey('local', firmId);
    if (!active) {
      try {
        return await this.rotateKey(firmId);
      } catch (err) {
        if (err.code === '23505') {
          const winner = await db.getActiveEncryptionKey('local', firmId);
          if (winner) {
            const dek = this._unwrapDek(winner.id, winner.wrapped_dek);
            this._dekCache.set(winner.id, dek);
            return { keyId: winner.id, dek };
          }
        }
        throw err;
      }
    }
    if (this._dekCache.has(active.id)) {
      return { keyId: active.id, dek: this._dekCache.get(active.id) };
    }
    const dek = this._unwrapDek(active.id, active.wrapped_dek);
    this._dekCache.set(active.id, dek);
    return { keyId: active.id, dek };
  }

  /**
   * Returns the DEK for a specific (possibly retired) key id — needed to
   * decrypt older messages after a rotation. No firmId parameter: a key
   * id already uniquely identifies one key belonging to one firm, and
   * every caller that has a key id got it from a message row it already
   * proved access to via firm-scoped reads upstream — see
   * db.getEncryptionKeyById's own comment.
   */
  async getDekById(keyId) {
    if (this._dekCache.has(keyId)) return this._dekCache.get(keyId);

    const row = await db.getEncryptionKeyById(keyId);
    if (!row) {
      throw new Error(`No encryption key found with id ${keyId} — a message references a key that no longer exists in encryption_keys.`);
    }
    const dek = this._unwrapDek(keyId, row.wrapped_dek);
    this._dekCache.set(keyId, dek);
    return dek;
  }

  /**
   * A firm-agnostic liveness check for the boot-time requirement
   * (server/services/encryption/messageEncryptionService.js) — just
   * confirms the local master key itself is configured and well-formed.
   * Deliberately does NOT mint or touch any firm's key: there's no single
   * firm to check at boot, and minting one blindly for whichever firm
   * happens to exist first would be arbitrary.
   */
  checkConnectivity() {
    getMasterKey(); // throws with a clear message if unset/malformed
  }
}

// One shared instance per process — the cache is the whole point.
let instance = null;
function getLocalKeyProvider() {
  if (!instance) instance = new LocalKeyProvider();
  return instance;
}

module.exports = { LocalKeyProvider, getLocalKeyProvider };
