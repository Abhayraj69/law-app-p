const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../services/totp');

/**
 * TOTP implementation tests — no database needed. Verifies against RFC
 * 4226's own published HOTP test vectors (Appendix D) rather than only
 * round-tripping our own code against itself, since a self-consistent but
 * RFC-incompatible implementation would silently reject every real
 * authenticator app (Google Authenticator, Authy, 1Password, etc.).
 */

// RFC 4226 Appendix D: secret is the ASCII string "12345678901234567890",
// with expected 6-digit HOTP codes for counters 0 through 9.
const RFC_4226_SECRET_ASCII = '12345678901234567890';
const RFC_4226_EXPECTED = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

test('TOTP — RFC 4226 HOTP test vectors', () => {
  const secretBase32 = totp.base32Encode(Buffer.from(RFC_4226_SECRET_ASCII, 'ascii'));
  RFC_4226_EXPECTED.forEach((expected, counter) => {
    assert.equal(totp.computeHotp(secretBase32, counter), expected, `counter ${counter}`);
  });
});

test('TOTP — base32 round-trips arbitrary byte lengths', () => {
  for (const len of [10, 16, 20, 21, 33]) {
    const original = require('node:crypto').randomBytes(len);
    const decoded = totp.base32Decode(totp.base32Encode(original));
    assert.deepEqual(decoded, original);
  }
});

test('TOTP — computeTotp/verifyTotp round-trip', async (t) => {
  const secret = totp.generateSecret();

  await t.test('a freshly generated code verifies', () => {
    const now = Date.now();
    const code = totp.computeTotp(secret, now);
    assert.equal(totp.verifyTotp(secret, code, now), true);
  });

  await t.test('a code from one step earlier still verifies (clock drift tolerance)', () => {
    const now = Date.now();
    const earlier = totp.computeTotp(secret, now - 30_000);
    assert.equal(totp.verifyTotp(secret, earlier, now), true);
  });

  await t.test('a code from two steps earlier is rejected', () => {
    const now = Date.now();
    const tooOld = totp.computeTotp(secret, now - 60_000);
    assert.equal(totp.verifyTotp(secret, tooOld, now), false);
  });

  await t.test('a code for a different secret is rejected', () => {
    const now = Date.now();
    const otherSecret = totp.generateSecret();
    const code = totp.computeTotp(otherSecret, now);
    assert.equal(totp.verifyTotp(secret, code, now), false);
  });

  await t.test('garbage input never throws and is rejected', () => {
    assert.equal(totp.verifyTotp(secret, 'not-a-code'), false);
    assert.equal(totp.verifyTotp(secret, ''), false);
    assert.equal(totp.verifyTotp(secret, null), false);
    assert.equal(totp.verifyTotp(secret, '12345'), false);
  });
});

test('TOTP — otpauth URL carries the standard fields an authenticator app expects', () => {
  const secret = totp.generateSecret();
  const url = totp.buildOtpAuthUrl(secret, 'user@example.com', 'SLF Practice Management');
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.match(url, new RegExp(`secret=${secret}`));
  assert.match(url, /algorithm=SHA1/);
  assert.match(url, /digits=6/);
  assert.match(url, /period=30/);
});
