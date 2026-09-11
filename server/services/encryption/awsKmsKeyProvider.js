const crypto = require('crypto');
const { KMSClient, GenerateDataKeyCommand, DecryptCommand } = require('@aws-sdk/client-kms');
const db = require('../../db');

/**
 * AWS KMS Key Provider — envelope encryption for message data keys.
 *
 * The KMS master key (KMS_KEY_ARN) never leaves AWS and is never used to
 * encrypt message content directly — only to wrap/unwrap small 256-bit
 * data encryption keys (DEKs). Message bodies are encrypted locally with
 * a DEK (see messageCipher.js), and only the DEK's wrapped (KMS-encrypted)
 * form is ever persisted, in encryption_keys.wrapped_dek. This is the
 * standard envelope-encryption pattern AWS itself uses for S3-SSE-KMS,
 * EBS, DynamoDB encryption, etc. — it avoids sending every message to KMS
 * (slow, expensive, and a KMS outage would take down messaging entirely)
 * while still keeping the actual key-management authority in KMS: no
 * database compromise alone can ever recover a plaintext DEK, because the
 * DEK never has a plaintext form persisted anywhere.
 *
 * `kmsClient` is injectable (defaults to a real KMSClient using the AWS
 * SDK's normal credential chain — env vars, an IAM role, an instance
 * profile, etc. per AWS conventions, never a credential this code reads
 * or handles itself) so this provider's wrap/unwrap/cache/rotate logic
 * can be tested with a mock client, without a real AWS account.
 */
class AwsKmsKeyProvider {
  constructor({ kmsClient, keyArn } = {}) {
    this.keyArn = keyArn || process.env.KMS_KEY_ARN;
    if (!this.keyArn) {
      throw new Error(
        'KMS_KEY_ARN is not set. Outside NODE_ENV=development, message encryption requires a real ' +
        'AWS KMS customer master key — set KMS_KEY_ARN to its ARN in .env.local (or the deployment ' +
        "environment's secrets). See .env.example."
      );
    }
    this.kms = kmsClient || new KMSClient({});
    // In-process only, keyed by encryption_keys.id — a decrypted DEK is
    // never written to disk or logs, and this cache is what keeps normal
    // message traffic from calling KMS on every single read/write.
    this._dekCache = new Map();
  }

  /** Mints a brand-new active DEK via KMS, retiring whatever was active before. */
  async rotateKey() {
    await db.retireActiveEncryptionKeys('aws_kms');

    const result = await this.kms.send(new GenerateDataKeyCommand({
      KeyId: this.keyArn,
      KeySpec: 'AES_256'
    }));
    // Plaintext is the raw 32-byte DEK — used immediately, NEVER stored.
    // CiphertextBlob is the KMS-wrapped form — that's what gets persisted.
    const dek = Buffer.from(result.Plaintext);
    const wrappedDek = Buffer.from(result.CiphertextBlob);

    const keyId = crypto.randomUUID();
    await db.insertEncryptionKey({ id: keyId, provider: 'aws_kms', kmsKeyArn: this.keyArn, wrappedDek });
    this._dekCache.set(keyId, dek);
    return { keyId, dek };
  }

  /**
   * Returns the current active DEK, minting one on first use if none
   * exists yet. Two processes can both observe "no active key" and race
   * to mint the first one via GenerateDataKey — the database's partial
   * unique index (idx_one_active_key_per_provider, db/migrations/0006)
   * rejects the loser's insert with a 23505, at which point the loser
   * simply reads back and uses the winner's key (one extra KMS Decrypt
   * call to unwrap it) instead of erroring or minting a second,
   * orphaned active key.
   */
  async getActiveDek() {
    const active = await db.getActiveEncryptionKey('aws_kms');
    if (!active) {
      try {
        return await this.rotateKey();
      } catch (err) {
        if (err.code === '23505') {
          const winner = await db.getActiveEncryptionKey('aws_kms');
          if (winner) {
            const dek = await this._unwrapViaKms(winner.id, winner.wrapped_dek, winner.kms_key_arn);
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
    const dek = await this._unwrapViaKms(active.id, active.wrapped_dek, active.kms_key_arn);
    this._dekCache.set(active.id, dek);
    return { keyId: active.id, dek };
  }

  /** Returns the DEK for a specific (possibly retired) key id — needed to decrypt older messages after a rotation. */
  async getDekById(keyId) {
    if (this._dekCache.has(keyId)) return this._dekCache.get(keyId);

    const row = await db.getEncryptionKeyById(keyId);
    if (!row) {
      throw new Error(`No encryption key found with id ${keyId} — a message references a key that no longer exists in encryption_keys.`);
    }
    const dek = await this._unwrapViaKms(keyId, row.wrapped_dek, row.kms_key_arn);
    this._dekCache.set(keyId, dek);
    return dek;
  }

  async _unwrapViaKms(keyId, wrappedDek, kmsKeyArn) {
    const result = await this.kms.send(new DecryptCommand({
      CiphertextBlob: wrappedDek,
      KeyId: kmsKeyArn || this.keyArn
    }));
    return Buffer.from(result.Plaintext);
  }
}

let instance = null;
function getAwsKmsKeyProvider() {
  if (!instance) instance = new AwsKmsKeyProvider();
  return instance;
}
// Test-only escape hatch: lets a test inject a mock KMS client without
// going through the module-level singleton (which always builds a real
// KMSClient from ambient AWS credentials).
function resetAwsKmsKeyProviderForTests(providerInstance) {
  instance = providerInstance || null;
}

module.exports = { AwsKmsKeyProvider, getAwsKmsKeyProvider, resetAwsKmsKeyProviderForTests };
