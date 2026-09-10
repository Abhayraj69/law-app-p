const crypto = require('crypto');
const { inMemoryDb } = require('../db');

/**
 * File Operations Service (Row Actions)
 * Handles previews, downloads, share links, metadata patch, and soft-delete/archive.
 */

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
   * Generates secure download headers and stream metadata
   */
  static async getDownloadStream(tenantId, docId) {
    const doc = inMemoryDb.documents.find(d => d.id === docId && d.firm_id === tenantId && !d.is_deleted);
    if (!doc) {
      const err = new Error(`Document '${docId}' not found.`);
      err.status = 404;
      throw err;
    }

    return {
      document: doc,
      headers: {
        'Content-Type': doc.file_type,
        'Content-Length': doc.file_size_bytes,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.original_name)}"`
      },
      file_path: doc.storage_path_url
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
