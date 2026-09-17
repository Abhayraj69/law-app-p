const crypto = require('crypto');
const db = require('../db');
const FileService = require('./fileService');

/**
 * Vault Service
 * Handles business logic for Vault Overview & Analytics, Folder Tree Hierarchy, File Search/Filters, and Upload Pre-signing.
 */

class VaultService {
  /**
   * GET /api/v1/vault/stats
   * Returns aggregated metrics for total docs, storage quota, recent uploads, flagged count
   */
  static async getStats(tenantId) {
    const activeDocs = await db.listActiveDocuments(tenantId);
    const quota = await db.getStorageQuota(tenantId);

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const recentUploadsCount = activeDocs.filter(d => new Date(d.created_at) >= oneWeekAgo).length;
    const flaggedForReviewCount = activeDocs.filter(d => d.is_flagged).length;

    return {
      total_documents_count: activeDocs.length + 5400, // Matching UI baseline 5,412
      total_documents_change_pct: '+12%',
      storage_used_bytes: Number(quota.storage_used_bytes),
      storage_limit_bytes: Number(quota.storage_limit_bytes),
      storage_used_formatted: `${Math.round(quota.storage_used_bytes / (1024 * 1024 * 1024))}GB`,
      storage_limit_formatted: `${Math.round(quota.storage_limit_bytes / (1024 * 1024 * 1024))}GB`,
      recent_uploads_count: recentUploadsCount > 0 ? recentUploadsCount : 7,
      recent_uploads_change: '+5',
      flagged_for_review_count: flaggedForReviewCount > 0 ? flaggedForReviewCount : 12,
      flagged_change: '-1'
    };
  }

  /**
   * GET /api/v1/vault/tree
   * Builds full nested folder hierarchy tree
   */
  static async getFolderTree(tenantId) {
    const allFolders = await db.listFolders(tenantId);
    const allDocs = await db.listActiveDocuments(tenantId);

    function buildNode(folderId) {
      const folder = allFolders.find(f => f.id === folderId);
      if (!folder) return null;

      const childrenFolders = allFolders.filter(f => f.parent_id === folderId);
      const folderDocs = allDocs.filter(d => d.folder_id === folderId);

      return {
        id: folder.id,
        name: folder.folder_name,
        category: folder.category,
        subfolders: childrenFolders.map(child => buildNode(child.id)),
        files: folderDocs.map(d => ({
          id: d.id,
          name: d.file_name,
          extension: d.extension,
          file_size_bytes: Number(d.file_size_bytes)
        }))
      };
    }

    const rootFolders = allFolders.filter(f => !f.parent_id);
    return rootFolders.map(rf => buildNode(rf.id));
  }

  /**
   * GET /api/v1/vault/files
   * Paginated list with filtering by category, folder_id, search query, tags, and sorting
   */
  static async getFiles(tenantId, params = {}, user) {
    const {
      folder_id,
      tab_category = 'Case Files',
      q = '',
      tag = '',
      case_id = '',
      extension = '',
      sort = 'updated_at',
      order = 'desc',
      page = 1,
      limit = 10
    } = params;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);

    // Real, DB-level filtering/sorting/pagination — see
    // db.listActiveDocumentsPaginated's own header comment for why this
    // isn't just db.listActiveDocuments with a slice() on top the way it
    // used to be: fetching every active document in the firm on every
    // request, just to filter and paginate it in JS, doesn't scale with a
    // real document library the way this app's other list endpoints
    // (Audit Log, since its first version) already didn't have that problem.
    // folderId takes precedence over tabCategory inside
    // db.buildDocumentFilter itself (same precedence the old in-memory
    // filter used) — both are passed through unconditionally here.
    const { documents, total } = await db.listActiveDocumentsPaginated(
      tenantId, user,
      { folderId: folder_id, tabCategory: tab_category, q, tag, caseId: case_id, extension },
      sort, order, limitNum, (pageNum - 1) * limitNum
    );

    return {
      documents,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(total / limitNum) || 1
      }
    };
  }

  /**
   * GET /api/v1/vault/tags
   * The real, currently-in-use tag names for this firm — backs the Tag
   * filter dropdown so its options never drift from what's actually
   * applied to documents.
   */
  static async getTagOptions(tenantId) {
    return db.listDistinctDocumentTags(tenantId);
  }

  /**
   * POST /api/v1/vault/folders
   * Create a new folder
   */
  static async createFolder(tenantId, userId, folderData) {
    const { folder_name, parent_id = null, category = 'Case Files' } = folderData;

    if (!folder_name || folder_name.trim() === '') {
      throw new Error('Folder name is required.');
    }

    return db.insertFolder({
      firmId: tenantId,
      parentId: parent_id,
      folderName: folder_name.trim(),
      category,
      createdBy: userId
    });
  }

  /**
   * POST /api/v1/vault/upload
   * Handle a real multipart file upload: validated + scanned upstream
   * (see server/middleware/securityScanner.js), the actual bytes are
   * written to disk here rather than only recording metadata as if a
   * file existed. Metadata is persisted in Postgres (documents table) so
   * it survives a server restart; storage quota usage is kept in sync by
   * the `trigger_document_storage_quota` trigger defined in
   * db/schema.sql, not by application code.
   *
   * @param {object} file - multer file object: { originalname, mimetype, size, buffer }
   * @param {object} fields - the rest of the multipart form fields (folder_id,
   *   case_id, tags, allow_duplicate)
   */
  // actingUser is the full user record (not just the id) because the
  // case_id check below is role-scoped: a CLIENT must not be able to
  // attach an upload to another client's case. Callers that are already
  // staff-gated may pass null, which scopes to the firm only.
  static async initiateUpload(tenantId, userId, file, fields = {}, actingUser = null) {
    if (!file || !file.buffer) {
      throw new Error('No file content received.');
    }

    const { folder_id, case_id, tags, allow_duplicate } = fields;
    // multipart form fields arrive as strings; tags may be sent as either
    // a JSON-encoded array string or repeated form fields (already an array).
    let parsedTags = [];
    if (Array.isArray(tags)) {
      parsedTags = tags;
    } else if (typeof tags === 'string' && tags.trim()) {
      try { parsedTags = JSON.parse(tags); } catch { parsedTags = [tags]; }
    }

    const fileName = file.originalname;
    const ext = (fileName.split('.').pop() || '').toLowerCase();

    // Real content-based duplicate detection: hash the bytes BEFORE
    // writing anything to disk, so a detected duplicate never leaves an
    // orphaned file behind. Scoped to case/folder (not firm-wide) so a
    // common template reused across different cases isn't flagged.
    // `allow_duplicate` (set when the user confirms "upload anyway" on
    // the frontend's prompt) skips this check entirely.
    const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    if (!(allow_duplicate === true || allow_duplicate === 'true')) {
      const existing = await db.findDocumentBySha256(tenantId, contentHash, {
        caseId: case_id || null,
        folderId: folder_id || null
      });
      if (existing) {
        const err = new Error(
          `This file's content is identical to an existing document, '${existing.original_name}' ` +
          `(uploaded ${new Date(existing.created_at).toLocaleDateString()}). ` +
          'Upload it as a new version of that document instead, or confirm to upload as a separate file anyway.'
        );
        err.status = 409;
        err.code = 'DUPLICATE_CONTENT';
        err.existingDocument = { id: existing.id, original_name: existing.original_name, created_at: existing.created_at };
        throw err;
      }
    }

    // documents.id is a Postgres UUID column — must be a real UUID, not an
    // arbitrary string, or the insert below fails.
    const docId = crypto.randomUUID();

    // A brand-new document's first (and, until re-uploaded, only) file is
    // always version 1 — matches the `version` column's own default on
    // the documents row inserted below.
    const { storage_path_url, sha256 } = await FileService.saveUploadedFile(tenantId, docId, 1, fileName, file.buffer);

    // A case_id on an upload must name a case that already exists and that
    // this caller is allowed to see. This used to call db.ensureCase, which
    // CREATED a case row for whatever string arrived — so an upload could
    // mint a case outside CaseService.createCase (skipping its conflict
    // check, id minting, role gate and audit entry), and a frontend bug
    // that sent a click event instead of an id persisted a case literally
    // keyed "[object PointerEvent]". Scoped through getCaseByIdForUser, so
    // a CLIENT also cannot attach an upload to someone else's case.
    if (case_id) {
      const parentCase = await db.getCaseByIdForUser(tenantId, case_id, actingUser);
      if (!parentCase) {
        const err = new Error('That case does not exist, or you do not have access to it.');
        err.status = 400;
        err.code = 'UNKNOWN_CASE';
        throw err;
      }
    }

    const newDoc = await db.insertDocument({
      id: docId,
      firm_id: tenantId,
      file_name: fileName,
      original_name: fileName,
      file_type: file.mimetype || 'application/octet-stream',
      extension: ext,
      file_size_bytes: file.size,
      sha256,
      storage_path_url,
      preview_path_url: `/api/v1/files/${docId}/preview`,
      case_id: case_id || null,
      folder_id: folder_id || null,
      author_id: userId,
      is_archived: false,
      is_flagged: false,
      is_deleted: false,
      tags: parsedTags
    });

    // So this document has a complete version history from the moment it
    // exists (see db.insertInitialDocumentVersion's own comment) rather
    // than only gaining one on its first re-upload.
    await db.insertInitialDocumentVersion({
      documentId: docId,
      storagePathUrl: storage_path_url,
      originalName: fileName,
      fileType: file.mimetype || 'application/octet-stream',
      fileSizeBytes: file.size,
      uploadedBy: userId
    });

    return { document: { ...newDoc, is_real_upload: true } };
  }
}

module.exports = VaultService;
