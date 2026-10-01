const crypto = require('node:crypto');

/**
 * TOTP (RFC 6238, built on the HOTP algorithm in RFC 4226) — implemented
 * directly against Node's built-in `crypto` module rather than adding a
 * third-party dependency for something this narrowly scoped and easy to
 * verify against the RFC's own published test vectors (see
 * server/test/totp.test.js). SHA-1/6 digits/30-second step is the
 * universal default every authenticator app (Google Authenticator, Authy,
 * 1Password, etc.) assumes when no algorithm is specified in the
 * otpauth:// URL, so those are not configurable here.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const STEP_SECONDS = 30;

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) continue;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** A fresh random 160-bit secret (the size RFC 4226 recommends), base32-encoded for display/storage. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// RFC 4226 §5.3 HOTP(K, C) — truncated dynamically to a 6-digit code.
function computeHotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binCode % 10 ** DIGITS).padStart(DIGITS, '0');
}

function computeTotp(secretBase32, atTimeMs = Date.now()) {
  const counter = Math.floor(atTimeMs / 1000 / STEP_SECONDS);
  return computeHotp(secretBase32, counter);
}

/**
 * Accepts a code from the current 30-second step or one step to either
 * side (±30s), the standard authenticator-app clock-drift tolerance —
 * without it, a device even a few seconds slow would be rejected on every
 * single attempt near a step boundary.
 */
function verifyTotp(secretBase32, token, atTimeMs = Date.now()) {
  const candidate = String(token || '').trim();
  if (!/^\d{6}$/.test(candidate)) return false;

  const counter = Math.floor(atTimeMs / 1000 / STEP_SECONDS);
  for (const drift of [0, -1, 1]) {
    if (computeHotp(secretBase32, counter + drift) === candidate) return true;
  }
  return false;
}

function buildOtpAuthUrl(secretBase32, accountLabel, issuer) {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS)
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { generateSecret, computeHotp, computeTotp, verifyTotp, buildOtpAuthUrl, base32Encode, base32Decode };
