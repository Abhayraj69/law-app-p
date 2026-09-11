const test = require('node:test');
const assert = require('node:assert/strict');

// server/services/encryption/awsKmsKeyProvider.js transitively requires
// server/db.js -> server/db/pool.js, which constructs a pg.Pool at
// require time and throws immediately if no DATABASE_URL/PGHOST+PGDATABASE
// is present at all in process.env — even though nothing in this file
// ever actually issues a query. Loading .env.local satisfies that
// construction-time check; it does not make these tests depend on a
// reachable database (checkConnectivity never touches one).
require('../env');

/**
 * Tests for the NODE_ENV-gated message-encryption boot requirement
 * (server/services/encryption/messageEncryptionService.js's
 * checkMessageEncryptionRequirement, called from server/server.js at
 * boot — mirrors server/middleware/securityScanner.js's
 * checkClamAvRequirement both in rule and in test structure).
 *
 * Pure logic tests — no database needed (checkConnectivity on either
 * provider never touches Postgres), unlike the other message-encryption
 * suite (server/test/messageEncryption.test.js), so these always run.
 */

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

test('messageEncryptionRequiresKms: false only for NODE_ENV=development', async () => {
  const { messageEncryptionRequiresKms } = require('../services/encryption/keyProvider');
  await withEnv({ NODE_ENV: 'development' }, () => assert.equal(messageEncryptionRequiresKms(), false));
  await withEnv({ NODE_ENV: 'production' }, () => assert.equal(messageEncryptionRequiresKms(), true));
  await withEnv({ NODE_ENV: 'test' }, () => assert.equal(messageEncryptionRequiresKms(), true));
  await withEnv({ NODE_ENV: undefined }, () => {
    delete process.env.NODE_ENV;
    assert.equal(messageEncryptionRequiresKms(), true, 'an unset NODE_ENV must NOT be treated as an implicit development mode');
  });
});

test('checkMessageEncryptionRequirement: no-op in development, even with no local key configured at all', async () => {
  const { checkMessageEncryptionRequirement } = require('../services/encryption/messageEncryptionService');
  await withEnv({ NODE_ENV: 'development' }, async () => {
    delete process.env.MESSAGE_ENCRYPTION_LOCAL_KEY;
    await assert.doesNotReject(() => checkMessageEncryptionRequirement());
  });
});

test('checkMessageEncryptionRequirement: throws outside development when KMS_KEY_ARN is unset', async () => {
  const { checkMessageEncryptionRequirement } = require('../services/encryption/messageEncryptionService');
  const { resetAwsKmsKeyProviderForTests } = require('../services/encryption/awsKmsKeyProvider');
  resetAwsKmsKeyProviderForTests(null); // clear any singleton from an earlier test in this file

  await withEnv({ NODE_ENV: 'production' }, async () => {
    delete process.env.KMS_KEY_ARN;
    await assert.rejects(() => checkMessageEncryptionRequirement(), /KMS_KEY_ARN is not set/);
  });
  resetAwsKmsKeyProviderForTests(null);
});

test('checkMessageEncryptionRequirement: throws outside development when KMS is configured but unreachable', async () => {
  const { checkMessageEncryptionRequirement } = require('../services/encryption/messageEncryptionService');
  const { AwsKmsKeyProvider, resetAwsKmsKeyProviderForTests } = require('../services/encryption/awsKmsKeyProvider');

  const failingClient = { async send() { throw new Error('simulated network failure reaching KMS'); } };
  resetAwsKmsKeyProviderForTests(new AwsKmsKeyProvider({ kmsClient: failingClient, keyArn: 'arn:aws:kms:us-east-1:000000000000:key/test-key' }));

  await withEnv({ NODE_ENV: 'production' }, async () => {
    await assert.rejects(() => checkMessageEncryptionRequirement(), /simulated network failure/);
  });
  resetAwsKmsKeyProviderForTests(null);
});

test('checkMessageEncryptionRequirement: resolves outside development when KMS actually responds (mock client)', async () => {
  const { checkMessageEncryptionRequirement } = require('../services/encryption/messageEncryptionService');
  const { AwsKmsKeyProvider, resetAwsKmsKeyProviderForTests } = require('../services/encryption/awsKmsKeyProvider');

  let calls = 0;
  const workingClient = {
    async send(command) {
      calls++;
      assert.equal(command.constructor.name, 'GenerateDataKeyCommand');
      assert.equal(command.input.NumberOfBytes, 1, 'the boot check should mint a throwaway 1-byte key, not a real 32-byte DEK');
      return { Plaintext: Buffer.from([0]), CiphertextBlob: Buffer.from([0]) };
    }
  };
  resetAwsKmsKeyProviderForTests(new AwsKmsKeyProvider({ kmsClient: workingClient, keyArn: 'arn:aws:kms:us-east-1:000000000000:key/test-key' }));

  await withEnv({ NODE_ENV: 'production' }, async () => {
    await assert.doesNotReject(() => checkMessageEncryptionRequirement());
  });
  assert.equal(calls, 1);
  resetAwsKmsKeyProviderForTests(null);
});
