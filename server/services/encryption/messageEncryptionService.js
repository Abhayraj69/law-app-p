const { getKeyProvider, messageEncryptionRequiresKms } = require('./keyProvider');
const cipher = require('./messageCipher');

/**
 * Message Encryption Service
 *
 * The one module server/services/communicationsService.js actually talks
 * to — it doesn't know or care whether a DEK came from AWS KMS or the
 * local dev provider, only that this service can encrypt a plaintext body
 * for a specific message and decrypt one back.
 */

/**
 * Encrypts a message body for storage. Always encrypts under the CURRENT
 * active key — a message's encryption_key_id is fixed at write time and
 * never changes, even across a later key rotation (see decrypt, which
 * looks the key up by id rather than assuming "active").
 *
 * @param {string} conversationId
 * @param {string} messageId - pre-generated (not DB-assigned) so it can
 *   be bound into the AAD before the row is ever inserted — see
 *   communicationsService.js, which generates the id client-side for
 *   exactly this reason.
 * @param {string} plaintext
 * @returns {Promise<{ bodyCiphertext: Buffer, bodyNonce: Buffer, bodyAuthTag: Buffer, encryptionKeyId: string }>}
 */
async function encryptMessageBody({ conversationId, messageId, plaintext }) {
  const { keyId, dek } = await getKeyProvider().getActiveDek();
  const { ciphertext, nonce, authTag } = cipher.encrypt({ dek, conversationId, messageId, plaintext });
  return { bodyCiphertext: ciphertext, bodyNonce: nonce, bodyAuthTag: authTag, encryptionKeyId: keyId };
}

/**
 * Decrypts a message body given its stored ciphertext/nonce/tag and the
 * id of the key it was encrypted under (which may since have been
 * retired by a rotation — getDekById still resolves it, since a retired
 * key's wrapped form is kept around specifically so old messages stay
 * readable).
 */
async function decryptMessageBody({ conversationId, messageId, ciphertext, nonce, authTag, encryptionKeyId }) {
  const dek = await getKeyProvider().getDekById(encryptionKeyId);
  return cipher.decrypt({ dek, conversationId, messageId, ciphertext, nonce, authTag });
}

/**
 * Reads a message's plaintext body from a raw conversation_messages row,
 * whichever shape it's actually in — encrypted (body_ciphertext set) or,
 * during the migration window before the backfill script has reached
 * this row, still legacy plaintext (only `body` set). See
 * db/scripts/backfillMessageEncryption.js and README.md's migration plan.
 *
 * This is the ONLY place that reads a legacy plaintext `body` column —
 * every other code path goes through encrypted fields, so this fallback
 * disappears on its own the day the plaintext `body` column is finally
 * dropped (see db/manual-migrations/0007_drop_plaintext_message_body.sql).
 */
async function resolveMessageBody(row) {
  if (row.body_ciphertext) {
    return decryptMessageBody({
      conversationId: row.conversation_id,
      messageId: row.id,
      ciphertext: row.body_ciphertext,
      nonce: row.body_nonce,
      authTag: row.body_auth_tag,
      encryptionKeyId: row.encryption_key_id
    });
  }
  if (row.body !== null && row.body !== undefined) {
    return row.body; // not yet backfilled — see resolveMessageBody's doc comment above
  }
  return null;
}

/**
 * Called once at server boot (see server/server.js), alongside the
 * existing Postgres and ClamAV checks — fails fast and loud if message
 * encryption is required (anything but NODE_ENV=development) but KMS
 * isn't configured/reachable, rather than only discovering it the moment
 * the first real user sends a message.
 */
async function checkMessageEncryptionRequirement() {
  if (!messageEncryptionRequiresKms()) return;
  // Getting (or, on a brand-new deployment, minting) the active DEK is
  // exactly what sending/reading a message needs to succeed — so this
  // IS the right liveness check, not a separate synthetic one.
  await getKeyProvider().getActiveDek();
}

module.exports = {
  encryptMessageBody,
  decryptMessageBody,
  resolveMessageBody,
  checkMessageEncryptionRequirement
};
