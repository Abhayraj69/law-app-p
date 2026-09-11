const crypto = require('crypto');

/**
 * Message Cipher — AES-256-GCM field encryption primitives.
 *
 * This module knows nothing about KMS, Postgres, or conversations as a
 * concept — it just encrypts/decrypts a buffer under a 256-bit data
 * encryption key (DEK) the caller supplies, the same way it would for any
 * field-level encryption use. The DEK itself is never generated or stored
 * here — see keyProvider.js / messageEncryptionService.js for where a DEK
 * actually comes from (envelope-encrypted under a KMS master key, or a
 * local dev-only key).
 *
 * AES-256-GCM is authenticated encryption: decrypt() throws if the
 * ciphertext, nonce, tag, or AAD don't all match exactly what was
 * encrypted — this is what catches tampering (or a ciphertext quietly
 * moved to the wrong row) rather than silently returning garbage bytes as
 * if they were valid plaintext.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;  // AES-256
const IV_LENGTH = 12;   // 96-bit nonce — the length GCM is designed for; a 12-byte IV MUST be unique per encryption under the same key, which is why encrypt() always generates a fresh random one rather than accepting a caller-supplied one.
const AUTH_TAG_LENGTH = 16;

/**
 * Additional Authenticated Data: binds a ciphertext to the specific row
 * it belongs to. Without this, a database-level attacker (or a bug) could
 * copy one message's ciphertext/nonce/tag into a different message's
 * row and it would decrypt "successfully" as ciphertext-valid but
 * semantically wrong content. With AAD covering the conversation id and
 * message id, that swap makes the auth tag invalid and decryption fails
 * loudly instead.
 */
function buildAad(conversationId, messageId) {
  if (!conversationId || !messageId) {
    throw new Error('buildAad requires both conversationId and messageId.');
  }
  return Buffer.from(`conversation_messages:${conversationId}:${messageId}`, 'utf8');
}

function assertValidKey(dek) {
  if (!Buffer.isBuffer(dek) || dek.length !== KEY_LENGTH) {
    throw new Error(`A data encryption key must be a ${KEY_LENGTH}-byte Buffer (got ${Buffer.isBuffer(dek) ? dek.length + ' bytes' : typeof dek}).`);
  }
}

/**
 * @param {Buffer} dek - 32-byte data encryption key (plaintext, already unwrapped)
 * @param {string} conversationId
 * @param {string} messageId
 * @param {string} plaintext
 * @returns {{ ciphertext: Buffer, nonce: Buffer, authTag: Buffer }}
 */
function encrypt({ dek, conversationId, messageId, plaintext }) {
  assertValidKey(dek);
  if (typeof plaintext !== 'string') {
    throw new Error('encrypt() requires a string plaintext.');
  }

  const nonce = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, dek, nonce);
  cipher.setAAD(buildAad(conversationId, messageId));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { ciphertext, nonce, authTag };
}

/**
 * @param {Buffer} dek - 32-byte data encryption key (plaintext, already unwrapped)
 * @param {string} conversationId
 * @param {string} messageId
 * @param {Buffer} ciphertext
 * @param {Buffer} nonce
 * @param {Buffer} authTag
 * @returns {string} plaintext
 * @throws if the ciphertext/nonce/tag/AAD don't authenticate
 */
function decrypt({ dek, conversationId, messageId, ciphertext, nonce, authTag }) {
  assertValidKey(dek);
  if (!Buffer.isBuffer(ciphertext) || !Buffer.isBuffer(nonce) || !Buffer.isBuffer(authTag)) {
    throw new Error('decrypt() requires Buffer ciphertext, nonce, and authTag.');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, dek, nonce);
  decipher.setAAD(buildAad(conversationId, messageId));
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/** Generates a fresh random 256-bit key — used by key providers to mint a new DEK. */
function generateDek() {
  return crypto.randomBytes(KEY_LENGTH);
}

module.exports = {
  encrypt,
  decrypt,
  generateDek,
  buildAad,
  ALGORITHM,
  KEY_LENGTH,
  IV_LENGTH,
  AUTH_TAG_LENGTH
};
