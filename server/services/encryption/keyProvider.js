const { getLocalKeyProvider } = require('./localKeyProvider');
const { getAwsKmsKeyProvider } = require('./awsKmsKeyProvider');

/**
 * Key Provider Selection
 *
 * Mirrors the exact rule server/middleware/securityScanner.js already
 * uses for ClamAV — the same "strict everywhere except NODE_ENV=development"
 * convention, for the same reason: a caller-selectable escape hatch
 * outside development would defeat the point of requiring real key
 * management in every environment that matters. An unset NODE_ENV, 'test',
 * 'staging', or a typo all still require AWS KMS.
 */
function messageEncryptionRequiresKms() {
  return process.env.NODE_ENV !== 'development';
}

/**
 * @returns {import('./localKeyProvider').LocalKeyProvider | import('./awsKmsKeyProvider').AwsKmsKeyProvider}
 */
function getKeyProvider() {
  if (messageEncryptionRequiresKms()) {
    return getAwsKmsKeyProvider(); // throws if KMS_KEY_ARN isn't set
  }
  return getLocalKeyProvider();
}

module.exports = { getKeyProvider, messageEncryptionRequiresKms };
