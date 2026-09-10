const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { inMemoryDb } = require('../db');

/**
 * File Operations Service (Row Actions)
 * Handles previews, downloads, share links, metadata patch, and soft-delete/archive.
 *
 * Real files uploaded through the vault are written under STORAGE_ROOT,
 * one subdirectory per tenant, keyed by document id. The seed/demo
 * documents in server/db.js have no backing file on disk (they only ever
 * existed as metadata for the mock UI) — downloading one of those returns
 * a clear "not available" error rather than a broken stream.
 */

const STORAGE_ROOT = path.join(__dirname, '..', '..', 'storage', 'uploads');

function safeFileName(originalName) {
  // Strip path separators and anything else that isn't a normal filename
  // character, so a crafted "original" name can't escape STORAGE_ROOT or
  // collide with OS-reserved names.
  return String(originalName || 'file')
    .replace(/[/\\]/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(-180); // keep it reasonable; the doc id prefix guarantees uniqueness
}

function tenantDir(tenantId) {
  return path.join(STORAGE_ROOT, tenantId);
}

/**
 * Persist an uploaded file buffer to disk for a given (already-created)
 * document id. Returns the path stored on the document record.
 */
async function saveUploadedFile(tenantId, docId, originalName, buffer) {
  const dir = tenantDir(tenantId);
  await fs.promises.mkdir(dir, { recursive: true });

  const storedName = `${docId}_${safeFileName(originalName)}`;
  const absolutePath = path.join(dir, storedName);
  await fs.promises.writeFile(absolutePath, buffer);

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    // Stored on the document record; resolved back to an absolute path by
    // resolveStoragePath() below. Relative + tenant-scoped so it can't be
    // used to reach outside STORAGE_ROOT.
    storage_path_url: path.posix.join(tenantId, storedName),
    sha256
  };
}

function resolveStoragePath(relativeStoragePath) {
  const resolved = path.join(STORAGE_ROOT, relativeStoragePath);
  // Defense in depth: refuse to resolve outside STORAGE_ROOT even if a
  // stored path were somehow malformed.
  if (!resolved.startsWith(STORAGE_ROOT)) {
    throw new Error('Invalid storage path.');
  }
  return resolved;
}

class FileService {
  /**
   * GET /api/v1/files/:id/preview
   * Generates secure short-lived preview token & metadata for rendering PDF/docx/xlsx in UI
   */
  static async getPreview(tenantId, docId) {
    const doc = inMemoryDb.documents.find(d => d.id === docId && d.firm_id === tenantId && !d.is_deleted);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    const previewToken = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min expiration

    return {
      document_id: doc.id,
      file_name: doc.file_name,
      file_type: doc.file_type,
      extension: doc.extension,
      file_size_bytes: doc.file_size_bytes,
      preview_url: `/api/v1/files/${doc.id}/render?token=${previewToken}`,
      preview_type: doc.extension === 'pdf' ? 'PDF_NATIVE' : doc.extension === 'xlsx' ? 'SPREADSHEET_VIEW' : 'DOCUMENT_VIEW',
      expires_at: expiresAt
    };
  }

  /**
   * GET /api/v1/files/:id/download
   * Streams the real file from disk if one was actually uploaded through
   * this app; returns a clear error for the seed/demo documents that only
   * ever existed as metadata.
   */
  static async getDownloadStream(tenantId, docId) {
    const doc = inMemoryDb.documents.find(d => d.id === docId && d.firm_id === tenantId && !d.is_deleted);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    if (!doc.is_real_upload) {
      const err = new Error(
        `'${doc.file_name}' is a seed/demo record with no real file content — ` +
        `it was never actually uploaded. Upload a real file to download its content.`
      );
      err.status = 404;
      err.code = 'NO_FILE_CONTENT';
      throw err;
    }

    const absolutePath = resolveStoragePath(doc.storage_path_url);
    if (!fs.existsSync(absolutePath)) {
      const err = new Error(`Stored file for '${doc.file_name}' is missing on disk.`);
      err.status = 404;
      err.code = 'FILE_MISSING';
      throw err;
    }

    return {
      document: doc,
      headers: {
        'Content-Type': doc.file_type || 'application/octet-stream',
        'Content-Length': doc.file_size_bytes,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.original_name)}"`
      },
      stream: fs.createReadStream(absolutePath)
    };
  }

  /**
   * POST /api/v1/files/:id/share
   * Generates secure expirable tokenized share link with permissions
   */
  static async createShareLink(tenantId, userId, docId, shareData = {}) {
    const doc = inMemoryDb.documents.find(d => d.id === docId && d.firm_id === tenantId && !d.is_deleted);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    const { recipient_email = 'external.client@example.com', permission = 'VIEW', expiration_hours = 48 } = shareData;
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + expiration_hours * 60 * 60 * 1000).toISOString();

    const shareRecord = {
      id: `share-${Date.now()}`,
      document_id: doc.id,
      file_name: doc.file_name,
      shared_by: userId,
      recipient_email,
      permission,
      share_token: token,
      share_url: `https://slf.law/vault/share/${token}`,
      expires_at: expiresAt,
      created_at: new Date().toISOString()
    };

    inMemoryDb.shares.push(shareRecord);
    return shareRecord;
  }

  /**
   * PATCH /api/v1/files/:id
   * Updates metadata, renames, re-tags, flags/unflags, or moves folder
   */
  static async patchDocument(tenantId, docId, updates = {}) {
    const doc = inMemoryDb.documents.find(d => d.id === docId && d.firm_id === tenantId && !d.is_deleted);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    if (updates.file_name) doc.file_name = updates.file_name.trim();
    if (updates.folder_id !== undefined) doc.folder_id = updates.folder_id;
    if (updates.category) doc.category = updates.category;
    if (updates.is_flagged !== undefined) doc.is_flagged = Boolean(updates.is_flagged);
    if (updates.is_archived !== undefined) doc.is_archived = Boolean(updates.is_archived);
    if (updates.tags && Array.isArray(updates.tags)) doc.tags = updates.tags;

    doc.updated_at = new Date().toISOString();
    return doc;
  }

  /**
   * DELETE /api/v1/files/:id
   * Soft-deletes document and adjusts storage quota
   */
  static async deleteDocument(tenantId, docId) {
    const doc = inMemoryDb.documents.find(d => d.id === docId && d.firm_id === tenantId && !d.is_deleted);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    doc.is_deleted = true;
    doc.deleted_at = new Date().toISOString();

    // Adjust storage quota
    if (inMemoryDb.storage_quotas[tenantId]) {
      inMemoryDb.storage_quotas[tenantId].storage_used_bytes = Math.max(
        0,
        inMemoryDb.storage_quotas[tenantId].storage_used_bytes - doc.file_size_bytes
      );
    }

    return {
      message: `Document '${doc.file_name}' soft-deleted successfully.`,
      id: doc.id
    };
  }
}

module.exports = FileService;
module.exports.saveUploadedFile = saveUploadedFile;
module.exports.resolveStoragePath = resolveStoragePath;
