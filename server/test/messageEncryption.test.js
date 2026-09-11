const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Tests for application-level message encryption at rest
 * (db/migrations/0006_message_encryption.sql, server/services/encryption/).
 *
 * Covers, in order: the raw AES-256-GCM cipher (round trip, AAD tamper
 * detection, ciphertext/tag tamper detection), the local key provider
 * (mint-on-first-use, caching, rotation, decrypting under a retired key,
 * a genuine concurrent-mint race), a mock-KMS-backed AwsKmsKeyProvider
 * (envelope encryption without needing a real AWS account), the full
 * CommunicationsService integration (a message really is stored as
 * ciphertext in Postgres, never plaintext), the legacy-plaintext dual-read
 * fallback, and the backfill script.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped, not failed,
 * if it isn't set. Also requires MESSAGE_ENCRYPTION_LOCAL_KEY to be set
 * (see .env.local / .env.example) since NODE_ENV=development in this
 * project's local setup routes through LocalKeyProvider.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Message encryption at rest', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const cipher = require('../services/encryption/messageCipher');
  const { LocalKeyProvider } = require('../services/encryption/localKeyProvider');
  const { AwsKmsKeyProvider } = require('../services/encryption/awsKmsKeyProvider');
  const messageEncryption = require('../services/encryption/messageEncryptionService');
  const CommunicationsService = require('../services/communicationsService');
  const { backfill } = require('../scripts/backfillMessageEncryption');

  await runMigrations();

  // Set up once, used throughout — keys are scoped per firm
  // (db/migrations/0008_per_firm_encryption_keys.sql), so even the raw
  // key-provider tests below need a real firm id to test against.
  const FIRM_ID = crypto.randomUUID();
  const STAFF_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Message Encryption Test Firm', `msg-enc-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);
  const staff = await db.createUser({ id: STAFF_ID, firmId: FIRM_ID, email: `staff-${STAFF_ID}@example.com`, fullName: 'Test Staff', role: 'ASSOCIATE', initials: 'TS', passwordHash });
  const conv = await db.insertConversation({ firmId: FIRM_ID, clientName: 'Test Client' });

  // ── 1. Raw cipher: round trip + tamper detection ───────────────────────

  await t.test('messageCipher: encrypt/decrypt round trip returns the exact original plaintext', () => {
    const dek = cipher.generateDek();
    const plaintext = 'Please review the attached settlement offer by Friday.';
    const enc = cipher.encrypt({ dek, conversationId: 'conv-1', messageId: 'msg-1', plaintext });

    assert.notEqual(enc.ciphertext.toString('utf8'), plaintext, 'ciphertext must not just be the plaintext bytes');
    const decrypted = cipher.decrypt({ dek, conversationId: 'conv-1', messageId: 'msg-1', ...enc });
    assert.equal(decrypted, plaintext);
  });

  await t.test('messageCipher: decrypting with the wrong AAD (message bound to a different row) fails', () => {
    const dek = cipher.generateDek();
    const enc = cipher.encrypt({ dek, conversationId: 'conv-1', messageId: 'msg-1', plaintext: 'secret' });

    assert.throws(
      () => cipher.decrypt({ dek, conversationId: 'conv-1', messageId: 'msg-DIFFERENT', ...enc }),
      'a ciphertext moved to a different message id must fail to decrypt, not silently succeed'
    );
    assert.throws(
      () => cipher.decrypt({ dek, conversationId: 'conv-DIFFERENT', messageId: 'msg-1', ...enc }),
      'a ciphertext moved to a different conversation must fail to decrypt, not silently succeed'
    );
  });

  await t.test('messageCipher: a single flipped ciphertext byte is detected, not silently decrypted to garbage', () => {
    const dek = cipher.generateDek();
    const enc = cipher.encrypt({ dek, conversationId: 'conv-1', messageId: 'msg-1', plaintext: 'unmodified message' });
    const tampered = Buffer.from(enc.ciphertext);
    tampered[0] ^= 0xff; // flip every bit of the first byte

    assert.throws(() => cipher.decrypt({ dek, conversationId: 'conv-1', messageId: 'msg-1', ...enc, ciphertext: tampered }));
  });

  await t.test('messageCipher: a tampered auth tag is detected', () => {
    const dek = cipher.generateDek();
    const enc = cipher.encrypt({ dek, conversationId: 'conv-1', messageId: 'msg-1', plaintext: 'unmodified message' });
    const tamperedTag = Buffer.from(enc.authTag);
    tamperedTag[0] ^= 0xff;

    assert.throws(() => cipher.decrypt({ dek, conversationId: 'conv-1', messageId: 'msg-1', ...enc, authTag: tamperedTag }));
  });

  // ── 2. LocalKeyProvider: mint, cache, rotate, decrypt-under-retired-key ─

  await t.test('LocalKeyProvider: getActiveDek mints on first use, then returns the SAME key on subsequent calls', async () => {
    const provider = new LocalKeyProvider();
    const first = await provider.getActiveDek(FIRM_ID);
    const second = await provider.getActiveDek(FIRM_ID);
    assert.equal(first.keyId, second.keyId);
    assert.ok(first.dek.equals(second.dek));
  });

  await t.test('LocalKeyProvider: rotateKey retires the old key and mints a new active one; old messages still decrypt via getDekById', async () => {
    const provider = new LocalKeyProvider();
    const before = await provider.getActiveDek(FIRM_ID);

    const encryptedUnderOldKey = cipher.encrypt({ dek: before.dek, conversationId: 'conv-rot', messageId: 'msg-rot', plaintext: 'encrypted before rotation' });

    const after = await provider.rotateKey(FIRM_ID);
    assert.notEqual(after.keyId, before.keyId, 'rotation must produce a genuinely new key id');

    const nowActive = await provider.getActiveDek(FIRM_ID);
    assert.equal(nowActive.keyId, after.keyId, 'the newly rotated key must be the one reported as active');

    // The OLD key's row still exists (retired, not deleted) and its DEK
    // can still be recovered — this is what lets an already-encrypted
    // message stay readable forever, even after however many rotations.
    const oldDek = await provider.getDekById(before.keyId);
    const decrypted = cipher.decrypt({ dek: oldDek, conversationId: 'conv-rot', messageId: 'msg-rot', ...encryptedUnderOldKey });
    assert.equal(decrypted, 'encrypted before rotation');
  });

  await t.test('LocalKeyProvider.getActiveDek: gracefully recovers when it loses a concurrent first-mint race', async () => {
    // Keys are now scoped per (provider, firm) — db/migrations/0008 —
    // and this test uses its own fresh FIRM_ID, so there's no risk of
    // colliding with another concurrently-running test file the way an
    // earlier version of this test (written before per-firm scoping)
    // discovered when it tried forcibly clearing the shared global
    // active key. Even so, the race itself is exercised deterministically
    // rather than by timing: db.insertEncryptionKey is stubbed to fail
    // exactly the way a real unique-constraint collision would (23505 on
    // idx_one_active_key_per_provider_firm, added in db/migrations/0008)
    // — simulating "another process's insert won the race a moment before
    // mine" — which proves getActiveDek falls back to reading and using
    // the real winner's key instead of crashing or minting a duplicate.
    const realActive = await new LocalKeyProvider().getActiveDek(FIRM_ID); // the genuine current active key for this firm, whatever it is

    const racingProvider = new LocalKeyProvider();
    const originalGetActive = db.getActiveEncryptionKey;
    const originalInsert = db.insertEncryptionKey;
    const originalRetire = db.retireActiveEncryptionKeys;

    // First read pretends no active key exists yet for this firm (as if
    // this process checked a moment before the real winner's insert
    // committed); the SECOND read — inside getActiveDek's 23505 recovery
    // branch — is the real, unmodified lookup, which finds the real
    // winner's key.
    let getActiveCalls = 0;
    db.getActiveEncryptionKey = async (provider, firmId) => {
      getActiveCalls++;
      if (provider === 'local' && firmId === FIRM_ID && getActiveCalls === 1) return null;
      return originalGetActive(provider, firmId);
    };
    // rotateKey() (called by getActiveDek's "no active key" branch, which
    // the stub above forces it into) retires the current active key
    // before inserting — stubbed to a no-op since this test isn't
    // exercising retirement, only the insert-collision recovery path.
    db.retireActiveEncryptionKeys = async () => {};
    db.insertEncryptionKey = async () => {
      const err = new Error('duplicate key value violates unique constraint "idx_one_active_key_per_provider_firm"');
      err.code = '23505';
      throw err;
    };

    let result;
    try {
      result = await racingProvider.getActiveDek(FIRM_ID);
    } finally {
      // Restored immediately, pass or fail — these are shared module
      // exports, not per-test state, so a stub left in place would break
      // every other test (in this file or any concurrently-running one)
      // that happens to call db.getActiveEncryptionKey/insertEncryptionKey/
      // retireActiveEncryptionKeys after this.
      db.getActiveEncryptionKey = originalGetActive;
      db.insertEncryptionKey = originalInsert;
      db.retireActiveEncryptionKeys = originalRetire;
    }

    assert.equal(getActiveCalls, 2, 'the race-recovery path must re-read the active key after losing the insert, not just give up');

    assert.equal(result.keyId, realActive.keyId, 'losing the race must resolve to the SAME key the real winner has active, not throw and not mint a second one');
    assert.ok(result.dek.equals(realActive.dek));
  });

  // ── 3. AwsKmsKeyProvider: envelope encryption against a mock KMS client ─

  await t.test('AwsKmsKeyProvider: envelope encryption round trip using a mock KMS client (no real AWS account needed)', async () => {
    // A minimal stand-in for @aws-sdk/client-kms's KMSClient — just
    // enough to prove AwsKmsKeyProvider's wrap/unwrap/cache logic is
    // correct. GenerateDataKeyCommand returns a real random 32-byte
    // plaintext DEK plus a "wrapped" form; DecryptCommand reverses it.
    // The "wrapping" here is a stand-in (XOR with a fixed test key) —
    // this test is about AwsKmsKeyProvider's OWN logic (does it store
    // only the wrapped form, does it cache, does it call KMS again for a
    // different key id), not about re-testing AWS's own KMS
    // implementation, which this test has no way to exercise anyway.
    const testWrapKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').subarray(0, 32);
    function xorWrap(buf) { return Buffer.from(buf.map((b, i) => b ^ testWrapKey[i % testWrapKey.length])); }

    let generateCalls = 0;
    let decryptCalls = 0;
    const mockKmsClient = {
      async send(command) {
        if (command.constructor.name === 'GenerateDataKeyCommand') {
          generateCalls++;
          const plaintext = crypto.randomBytes(32);
          return { Plaintext: plaintext, CiphertextBlob: xorWrap(plaintext) };
        }
        if (command.constructor.name === 'DecryptCommand') {
          decryptCalls++;
          return { Plaintext: xorWrap(Buffer.from(command.input.CiphertextBlob)) };
        }
        throw new Error(`Unexpected KMS command: ${command.constructor.name}`);
      }
    };

    const provider = new AwsKmsKeyProvider({ kmsClient: mockKmsClient, keyArn: 'arn:aws:kms:us-east-1:000000000000:key/test-key' });

    // A fresh FIRM_ID (created at the top of this test file, unique to
    // this run) guarantees no active 'aws_kms' key already exists for
    // it, regardless of what earlier runs of this suite left behind —
    // keys are scoped per (provider, firm) since db/migrations/0008.
    const active = await provider.getActiveDek(FIRM_ID);
    assert.equal(generateCalls, 1, 'a fresh provider with no existing active key for this firm must mint one via GenerateDataKey');
    assert.equal(active.dek.length, 32);

    // Verify what's actually PERSISTED is the wrapped form, never the
    // plaintext DEK.
    const row = await db.getEncryptionKeyById(active.keyId);
    assert.equal(row.provider, 'aws_kms');
    assert.equal(row.kms_key_arn, 'arn:aws:kms:us-east-1:000000000000:key/test-key');
    assert.ok(!row.wrapped_dek.equals(active.dek), 'the stored wrapped_dek must never equal the plaintext DEK');

    // Encrypt a message under this DEK, then decrypt it back via the
    // provider's getDekById (a fresh provider instance, forcing an actual
    // KMS Decrypt call rather than serving from the first instance's cache).
    const enc = cipher.encrypt({ dek: active.dek, conversationId: 'conv-kms', messageId: 'msg-kms', plaintext: 'a KMS-protected message' });

    const provider2 = new AwsKmsKeyProvider({ kmsClient: mockKmsClient, keyArn: 'arn:aws:kms:us-east-1:000000000000:key/test-key' });
    const recoveredDek = await provider2.getDekById(active.keyId);
    assert.equal(decryptCalls, 1, 'recovering a key not yet in this provider instance\'s cache must call KMS Decrypt');
    const decrypted = cipher.decrypt({ dek: recoveredDek, conversationId: 'conv-kms', messageId: 'msg-kms', ...enc });
    assert.equal(decrypted, 'a KMS-protected message');

    // Calling getDekById again for the SAME key on the SAME provider
    // instance must be served from cache — no second KMS call.
    await provider2.getDekById(active.keyId);
    assert.equal(decryptCalls, 1, 'a cached key must not trigger a repeat KMS call');
  });

  // ── 4. Full integration: CommunicationsService really stores ciphertext ─

  await t.test('CommunicationsService.postMessage stores real ciphertext in Postgres — the plaintext never appears in the row', async () => {
    const secretText = 'This settlement amount must stay confidential: $847,500.';
    const posted = await CommunicationsService.postMessage(FIRM_ID, staff, conv.id, { text: secretText });

    assert.equal(posted.text, secretText, 'the API response must still return the real plaintext to an authorized reader');

    const { rows } = await pool.query('SELECT * FROM conversation_messages WHERE id = $1', [posted.id]);
    const raw = rows[0];
    assert.equal(raw.body, null, 'the legacy plaintext column must be left NULL for a new encrypted write');
    assert.ok(Buffer.isBuffer(raw.body_ciphertext) && raw.body_ciphertext.length > 0);
    assert.ok(!raw.body_ciphertext.toString('utf8').includes('847,500'), 'the plaintext dollar amount must not appear anywhere in the stored ciphertext bytes');
    assert.ok(!raw.body_ciphertext.toString('latin1').includes('confidential'), 'nor should any substring of the plaintext leak into the raw bytes under any encoding');
  });

  await t.test('CommunicationsService.getConversation decrypts messages back correctly, and the sidebar preview is decrypted too', async () => {
    const detail = await CommunicationsService.getConversation(FIRM_ID, conv.id, staff);
    assert.ok(detail.messages.some(m => m.text.includes('847,500')));

    const list = await CommunicationsService.listConversations(FIRM_ID, staff);
    const summary = list.find(c => c.id === conv.id);
    assert.ok(summary.preview.includes('847,500'), 'the conversation list preview must show real decrypted content, not ciphertext or a placeholder');
  });

  // ── 5. Legacy plaintext dual-read fallback (pre-backfill rows) ──────────

  await t.test('resolveMessageBody: a legacy plaintext row (no ciphertext yet) still reads correctly', async () => {
    const legacyText = 'A message written before the encryption migration.';
    const legacyRow = await pool.query(
      `INSERT INTO conversation_messages (conversation_id, sender, sender_user_id, body) VALUES ($1, 'staff', $2, $3) RETURNING *`,
      [conv.id, STAFF_ID, legacyText]
    );
    const resolved = await messageEncryption.resolveMessageBody(legacyRow.rows[0]);
    assert.equal(resolved, legacyText);
  });

  await t.test('a legacy plaintext message shows up correctly through the real read path (getConversation) before backfill', async () => {
    const legacyText2 = 'Another pre-migration message, still unencrypted in the DB.';
    await pool.query(
      `INSERT INTO conversation_messages (conversation_id, sender, sender_user_id, body) VALUES ($1, 'client', $2, $3)`,
      [conv.id, STAFF_ID, legacyText2]
    );
    const detail = await CommunicationsService.getConversation(FIRM_ID, conv.id, staff);
    assert.ok(detail.messages.some(m => m.text === legacyText2), 'a not-yet-backfilled plaintext row must still read correctly through the normal API path');
  });

  // ── 6. Backfill script ──────────────────────────────────────────────────

  await t.test('backfillMessageEncryption encrypts every pre-existing plaintext row and preserves the exact text', async () => {
    const beforeCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM conversation_messages WHERE conversation_id = $1 AND body IS NOT NULL AND body_ciphertext IS NULL`,
      [conv.id]
    );
    assert.ok(beforeCount.rows[0].n >= 2, 'sanity check: the two legacy rows inserted above should still be plaintext going into this test');

    await backfill();

    const afterCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM conversation_messages WHERE conversation_id = $1 AND body IS NOT NULL AND body_ciphertext IS NULL`,
      [conv.id]
    );
    assert.equal(afterCount.rows[0].n, 0, 'no plaintext rows should remain in this conversation after backfill');

    // The messages must still read back with the EXACT original text —
    // backfilling must not alter content, only its storage representation.
    const detail = await CommunicationsService.getConversation(FIRM_ID, conv.id, staff);
    assert.ok(detail.messages.some(m => m.text === 'A message written before the encryption migration.'));
    assert.ok(detail.messages.some(m => m.text === 'Another pre-migration message, still unencrypted in the DB.'));

    // Re-running backfill must be a safe no-op (idempotent).
    await backfill();
    const idempotentCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM conversation_messages WHERE conversation_id = $1 AND body IS NOT NULL AND body_ciphertext IS NULL`,
      [conv.id]
    );
    assert.equal(idempotentCount.rows[0].n, 0);
  });

  // Teardown — every other table references the firm with ON DELETE
  // CASCADE, so removing it removes the rest. encryption_keys is
  // deliberately NOT firm-scoped (see README.md's "Message encryption"
  // section) and is left alone — it's shared across the whole deployment.
  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
