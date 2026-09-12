const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');

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
 *
 * `versionNumber` is baked into the stored filename (not just the docId)
 * so that re-uploading the same original filename for the same document
 * never collides on disk with an earlier version's bytes — each version
 * is a real, independently-downloadable file, never overwritten. Always
 * required now (fresh uploads pass 1) rather than optional, so this can't
 * silently regress back to the old docId-only scheme.
 */
async function saveUploadedFile(tenantId, docId, versionNumber, originalName, buffer) {
  const dir = tenantDir(tenantId);
  await fs.promises.mkdir(dir, { recursive: true });

  const storedName = `${docId}_v${versionNumber}_${safeFileName(originalName)}`;
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
  static async getPreview(tenantId, docId, user) {
    const doc = await db.getDocumentById(tenantId, docId, user);
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
  static async getDownloadStream(tenantId, docId, user) {
    const doc = await db.getDocumentById(tenantId, docId, user);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    // Seed/demo records (and any document whose file was never actually
    // written to disk) don't have a real file to stream. We detect that by
    // checking disk directly rather than trusting a flag on the record,
    // since the record's metadata alone can't prove the bytes exist.
    let absolutePath;
    try {
      absolutePath = resolveStoragePath(doc.storage_path_url);
    } catch {
      absolutePath = null;
    }

    if (!absolutePath || !fs.existsSync(absolutePath)) {
      const err = new Error(
        `'${doc.file_name}' has no real file content on disk — it may be a seed/demo ` +
        `record that was never actually uploaded, or its stored file is missing.`
      );
      err.status = 404;
      err.code = 'NO_FILE_CONTENT';
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
   * GET /api/v1/files/:id/versions
   * Lists every version of a document, newest first. Ownership is checked
   * the same way getPreview/getDownloadStream check it (passing `user`
   * scopes a CLIENT caller to only their own cases' documents).
   */
  static async getVersions(tenantId, docId, user) {
    const doc = await db.getDocumentById(tenantId, docId, user);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    const versions = await db.listDocumentVersions(tenantId, docId);
    return versions.map(v => ({
      id: v.id,
      version_number: v.version_number,
      original_name: v.original_name,
      file_type: v.file_type,
      file_size_bytes: v.file_size_bytes,
      uploaded_by: v.uploaded_by,
      uploaded_by_name: v.uploaded_by_name,
      uploaded_at: v.uploaded_at,
      comment: v.comment,
      is_current: v.version_number === doc.version
    }));
  }

  /**
   * GET /api/v1/files/:id/versions/:versionId/download
   * Streams one specific past version's bytes — everything about this
   * mirrors getDownloadStream above except the row/path it resolves from.
   * `versionId` addresses a document_versions.id (its own UUID), not a
   * version_number, so it's an unambiguous single-resource lookup.
   */
  static async getVersionDownloadStream(tenantId, docId, versionId, user) {
    const doc = await db.getDocumentById(tenantId, docId, user);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    const version = await db.getDocumentVersionById(tenantId, docId, versionId);
    if (!version) {
      const err = new Error(`Version '${versionId}' not found for document '${docId}'.`);
      err.status = 404;
      throw err;
    }

    let absolutePath;
    try {
      absolutePath = resolveStoragePath(version.storage_path_url);
    } catch {
      absolutePath = null;
    }

    if (!absolutePath || !fs.existsSync(absolutePath)) {
      const err = new Error(
        `'${version.original_name}' (version ${version.version_number}) has no real file content on disk — ` +
        `it may be a seed/demo record that was never actually uploaded, or its stored file is missing.`
      );
      err.status = 404;
      err.code = 'NO_FILE_CONTENT';
      throw err;
    }

    return {
      version,
      headers: {
        'Content-Type': version.file_type || 'application/octet-stream',
        'Content-Length': version.file_size_bytes,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(version.original_name)}"`
      },
      stream: fs.createReadStream(absolutePath)
    };
  }

  /**
   * POST /api/v1/files/:id/versions
   * Re-upload: the actual replace-the-file path that never existed before
   * this — a fresh upload always inserted a whole new document row, and
   * PATCH /api/v1/files/:id only ever touched metadata. This adds a new
   * document_versions row and repoints the document at it (see
   * db.insertDocumentVersionAndPromote) rather than overwriting anything.
   */
  static async uploadNewVersion(tenantId, userId, docId, file, comment, user) {
    if (!file || !file.buffer) {
      const err = new Error('No file content received.');
      err.status = 400;
      throw err;
    }

    const doc = await db.getDocumentById(tenantId, docId, user);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    const nextVersion = doc.version + 1;
    const fileName = file.originalname;
    const { storage_path_url } = await saveUploadedFile(tenantId, docId, nextVersion, fileName, file.buffer);

    const version = await db.insertDocumentVersionAndPromote({
      firmId: tenantId,
      documentId: docId,
      versionNumber: nextVersion,
      storagePathUrl: storage_path_url,
      originalName: fileName,
      fileType: file.mimetype || 'application/octet-stream',
      fileSizeBytes: file.size,
      uploadedBy: userId,
      comment: comment || null
    });

    return { ...version, is_current: true };
  }

  /**
   * POST /api/v1/files/:id/share
   * Generates secure expirable tokenized share link with permissions
   */
  static async createShareLink(tenantId, userId, docId, shareData = {}) {
    const doc = await db.getDocumentById(tenantId, docId);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    const { recipient_email = 'external.client@example.com', permission = 'VIEW', expiration_hours = 48 } = shareData;
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + expiration_hours * 60 * 60 * 1000);

    const shareRecord = await db.insertShare({
      documentId: doc.id,
      sharedBy: userId,
      recipientEmail: recipient_email,
      shareToken: token,
      permission,
      expiresAt
    });

    return {
      ...shareRecord,
      file_name: doc.file_name,
      share_url: `https://slf.law/vault/share/${token}`
    };
  }

  /**
   * PATCH /api/v1/files/:id
   * Updates metadata, renames, re-tags, flags/unflags, or moves folder
   */
  static async patchDocument(tenantId, docId, updates = {}) {
    const doc = await db.getDocumentById(tenantId, docId);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    const patch = {};
    if (updates.file_name) patch.file_name = updates.file_name.trim();
    if (updates.folder_id !== undefined) patch.folder_id = updates.folder_id;
    if (updates.is_flagged !== undefined) patch.is_flagged = Boolean(updates.is_flagged);
    if (updates.is_archived !== undefined) patch.is_archived = Boolean(updates.is_archived);
    if (updates.tags && Array.isArray(updates.tags)) patch.tags = updates.tags;

    return db.updateDocument(tenantId, docId, patch);
  }

  /**
   * DELETE /api/v1/files/:id
   * Soft-deletes document. Storage quota is decremented automatically by
   * the `trigger_document_storage_quota` trigger (db/schema.sql) when
   * is_deleted flips to TRUE, not by application code.
   */
  static async deleteDocument(tenantId, docId) {
    const doc = await db.getDocumentById(tenantId, docId);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    await db.softDeleteDocument(tenantId, docId);

    return {
      message: `Document '${doc.file_name}' soft-deleted successfully.`,
      id: doc.id
    };
  }
}

module.exports = FileService;
module.exports.saveUploadedFile = saveUploadedFile;
module.exports.resolveStoragePath = resolveStoragePath;
