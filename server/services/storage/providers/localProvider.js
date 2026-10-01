const fs = require('fs');
const path = require('path');

/**
 * Local-disk storage provider — writes/reads files under STORAGE_ROOT (see
 * server/services/fileService.js), one subdirectory per tenant. This is
 * the right choice for a single instance with a persistent volume mounted
 * at STORAGE_ROOT (see T1 in docs/DEPLOYMENT_TASKS.md); it does not share
 * files between instances, which is what s3Provider.js is for.
 *
 * Every method takes/returns the same relative, tenant-scoped key
 * (`<tenantId>/<storedName>`) that's stored as storage_path_url on the
 * document record — never an absolute path — so callers never need to know
 * which provider is active.
 */

const STORAGE_ROOT = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : path.join(__dirname, '..', '..', '..', '..', 'storage', 'uploads');

function resolve(relativePath) {
  const resolved = path.join(STORAGE_ROOT, relativePath);
  // Defense in depth: refuse to resolve outside STORAGE_ROOT even if a
  // stored path were somehow malformed.
  if (!resolved.startsWith(STORAGE_ROOT)) {
    throw new Error('Invalid storage path.');
  }
  return resolved;
}

async function write(relativePath, buffer) {
  const absolutePath = resolve(relativePath);
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, buffer);
}

async function read(relativePath) {
  return fs.promises.readFile(resolve(relativePath));
}

async function remove(relativePath) {
  await fs.promises.rm(resolve(relativePath), { force: true });
}

async function exists(relativePath) {
  try {
    await fs.promises.access(resolve(relativePath));
    return true;
  } catch {
    return false;
  }
}

module.exports = { write, read, remove, exists, STORAGE_ROOT };
