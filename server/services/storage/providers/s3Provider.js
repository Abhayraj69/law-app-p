/**
 * S3-compatible object-storage provider — required once more than one
 * instance is running (see T2 in docs/DEPLOYMENT_TASKS.md). Most container
 * platforms can't attach one read-write volume to several replicas, so
 * horizontal scaling requires object storage that every instance can reach
 * over the network instead.
 *
 * storage_path_url on the document record is kept exactly as it already
 * was for the local provider — a relative, tenant-scoped key
 * (`<tenantId>/<storedName>`) — which is exactly what an S3 object key
 * wants to be, so no data migration is needed to switch providers other
 * than actually copying the bytes.
 */
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} = require('@aws-sdk/client-s3');

const BUCKET = process.env.STORAGE_S3_BUCKET;
// Optional key prefix, so one bucket can be shared across environments
// (e.g. "staging/", "prod/") without colliding.
const PREFIX = process.env.STORAGE_S3_PREFIX || '';

let client = null;
function getClient() {
  if (!client) {
    client = new S3Client({
      region: process.env.STORAGE_S3_REGION || process.env.AWS_REGION,
      // Only needed for S3-compatible non-AWS endpoints (e.g. MinIO,
      // R2). Left unset, the AWS SDK talks to real S3.
      ...(process.env.STORAGE_S3_ENDPOINT ? { endpoint: process.env.STORAGE_S3_ENDPOINT, forcePathStyle: true } : {})
    });
  }
  return client;
}

function requireBucket() {
  if (!BUCKET) {
    throw new Error('STORAGE_S3_BUCKET is not set — required when STORAGE_PROVIDER=s3.');
  }
  return BUCKET;
}

function key(relativePath) {
  return PREFIX + relativePath.split(require('path').sep).join('/');
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function write(relativePath, buffer) {
  await getClient().send(new PutObjectCommand({
    Bucket: requireBucket(),
    Key: key(relativePath),
    Body: buffer
  }));
}

async function read(relativePath) {
  const result = await getClient().send(new GetObjectCommand({
    Bucket: requireBucket(),
    Key: key(relativePath)
  }));
  return streamToBuffer(result.Body);
}

async function remove(relativePath) {
  await getClient().send(new DeleteObjectCommand({
    Bucket: requireBucket(),
    Key: key(relativePath)
  }));
}

async function exists(relativePath) {
  try {
    await getClient().send(new HeadObjectCommand({
      Bucket: requireBucket(),
      Key: key(relativePath)
    }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

module.exports = { write, read, remove, exists };
