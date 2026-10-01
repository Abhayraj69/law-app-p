/**
 * Boot-time configuration validation.
 *
 * The app already fails fast on PostgreSQL, ClamAV and KMS reachability
 * (see server/server.js's start()) — this covers the remaining
 * production-only settings that don't have their own reachability check,
 * so a deployment missing one of them starts happily and misbehaves
 * subtly later instead of refusing to boot.
 */
function validateProductionConfig() {
  if (process.env.NODE_ENV === 'development') return;

  const problems = [];

  if (!process.env.STORAGE_ROOT && process.env.STORAGE_PROVIDER !== 's3') {
    problems.push(
      'STORAGE_ROOT is not set and STORAGE_PROVIDER is not s3 - uploaded ' +
      'documents would be written to ephemeral container storage and lost on restart.'
    );
  }

  if ((process.env.JWT_SECRET || '').length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters.');
  }

  if (process.env.PGSSL === 'true' && process.env.PGSSL_INSECURE === 'true') {
    problems.push('PGSSL_INSECURE=true disables database certificate verification.');
  }

  if (problems.length) {
    throw new Error('Refusing to start:\n  - ' + problems.join('\n  - '));
  }
}

module.exports = { validateProductionConfig };
