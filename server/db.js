const { pool } = require('./db/pool');

/**
 * Database Access Layer
 *
 * Every function here issues a parameterized SQL query against Postgres
 * (see db/schema.sql for the table definitions). This replaces the old
 * `inMemoryDb` object that every service used to read/write directly —
 * that object reset to its seed fixtures on every process restart, which
 * meant nothing uploaded or edited through the app actually persisted.
 *
 * Callers (VaultService, FileService, AuthService, IntegrationService,
 * and the storageQuota/auditLogger middleware) call these functions
 * instead of touching a shared object; the shape of the data they get
 * back (field names, nesting) is kept the same as the old inMemoryDb
 * records so those callers didn't need to change their own logic, only
 * their data source.
 */

// Stable seed identifiers, reused by the seed script and by tests.
const DEFAULT_FIRM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const DEFAULT_USER_ID = 'u101ac10b-58cc-4372-a567-0e02b2c3d479';

// ── Firms ────────────────────────────────────────────────────────────────
async function getFirmById(firmId) {
  const { rows } = await pool.query('SELECT * FROM firms WHERE id = $1', [firmId]);
  return rows[0] || null;
}

// ── Users ────────────────────────────────────────────────────────────────
async function getUserByEmail(email) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return rows[0] || null;
}

async function getUserById(userId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return rows[0] || null;
}

async function getUserByIdAndFirm(userId, firmId) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE id = $1 AND firm_id = $2',
    [userId, firmId]
  );
  return rows[0] || null;
}

async function listUsersByFirm(firmId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE firm_id = $1', [firmId]);
  return rows;
}

async function createUser({ id, firmId, email, fullName, role, initials, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, firm_id, email, full_name, role, initials, password_hash)
     VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       role = EXCLUDED.role,
       initials = EXCLUDED.initials,
       password_hash = EXCLUDED.password_hash,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [id || null, firmId, email, fullName, role, initials, passwordHash]
  );
  return rows[0];
}

// ── Storage quotas ───────────────────────────────────────────────────────
async function getStorageQuota(firmId) {
  const { rows } = await pool.query('SELECT * FROM storage_quotas WHERE firm_id = $1', [firmId]);
  if (rows[0]) return rows[0];
  // No row yet for this firm — report the same defaults the old in-memory
  // fallback used, without creating a row (ensureStorageQuota is explicit).
  return { firm_id: firmId, storage_limit_bytes: 107374182400, storage_used_bytes: 34359738368 };
}

async function ensureStorageQuota(firmId, limitBytes = 107374182400) {
  await pool.query(
    `INSERT INTO storage_quotas (firm_id, storage_limit_bytes, storage_used_bytes)
     VALUES ($1, $2, 0)
     ON CONFLICT (firm_id) DO NOTHING`,
    [firmId, limitBytes]
  );
}

// ── Folders ──────────────────────────────────────────────────────────────
async function listFolders(firmId) {
  const { rows } = await pool.query('SELECT * FROM folders WHERE firm_id = $1', [firmId]);
  return rows;
}

async function insertFolder({ firmId, parentId, folderName, category, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO folders (firm_id, parent_id, folder_name, category, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [firmId, parentId, folderName, category, createdBy]
  );
  return rows[0];
}

async function getFolderById(firmId, folderId) {
  const { rows } = await pool.query(
    'SELECT * FROM folders WHERE firm_id = $1 AND id = $2',
    [firmId, folderId]
  );
  return rows[0] || null;
}

async function updateFolder(firmId, folderId, updates) {
  const setClauses = [];
  const values = [];
  let i = 1;

  if (updates.folder_name !== undefined) {
    setClauses.push(`folder_name = $${i}`);
    values.push(updates.folder_name);
    i += 1;
  }
  if (!setClauses.length) return getFolderById(firmId, folderId);

  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  values.push(firmId, folderId);
  await pool.query(
    `UPDATE folders SET ${setClauses.join(', ')} WHERE firm_id = $${i} AND id = $${i + 1}`,
    values
  );
  return getFolderById(firmId, folderId);
}

async function deleteFolder(firmId, folderId) {
  await pool.query('DELETE FROM folders WHERE firm_id = $1 AND id = $2', [firmId, folderId]);
}

// ── Cases (only what's needed to satisfy the documents.case_id FK and
//    display a case_name alongside a document; full case management is a
//    separate piece of work) ────────────────────────────────────────────
async function ensureCase(firmId, caseId, caseName, clientName) {
  if (!caseId) return null;
  const { rows } = await pool.query(
    `INSERT INTO cases (id, firm_id, case_name, client_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [caseId, firmId, caseName || caseId, clientName || 'Unknown']
  );
  return rows[0] || null;
}

// ── Tags ─────────────────────────────────────────────────────────────────
async function getOrCreateTagId(firmId, name) {
  const { rows } = await pool.query(
    `INSERT INTO tags (firm_id, name) VALUES ($1, $2)
     ON CONFLICT (firm_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [firmId, name]
  );
  return rows[0].id;
}

async function setDocumentTags(documentId, firmId, tagNames = []) {
  await pool.query('DELETE FROM document_tags WHERE document_id = $1', [documentId]);
  for (const name of tagNames) {
    const tagId = await getOrCreateTagId(firmId, name);
    await pool.query(
      `INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [documentId, tagId]
    );
  }
}

// ── Documents ────────────────────────────────────────────────────────────
const DOCUMENT_SELECT = `
  SELECT
    d.*,
    u.full_name AS author_name,
    u.initials AS author_initials,
    c.case_name,
    fo.category AS category,
    COALESCE(array_remove(array_agg(t.name), NULL), ARRAY[]::text[]) AS tags
  FROM documents d
  LEFT JOIN users u ON u.id = d.author_id
  LEFT JOIN cases c ON c.id = d.case_id
  LEFT JOIN folders fo ON fo.id = d.folder_id
  LEFT JOIN document_tags dt ON dt.document_id = d.id
  LEFT JOIN tags t ON t.id = dt.tag_id
`;

// pg returns BIGINT columns (file_size_bytes) as strings, since not every
// such value fits safely in a JS number — these are always small enough in
// practice, so normalize back to a number for callers/JSON responses.
function normalizeDocumentRow(row) {
  if (!row) return row;
  return { ...row, file_size_bytes: Number(row.file_size_bytes) };
}

async function listActiveDocuments(firmId) {
  const { rows } = await pool.query(
    `${DOCUMENT_SELECT}
     WHERE d.firm_id = $1 AND d.is_deleted = FALSE
     GROUP BY d.id, u.full_name, u.initials, c.case_name, fo.category`,
    [firmId]
  );
  return rows.map(normalizeDocumentRow);
}

async function getDocumentById(firmId, docId) {
  const { rows } = await pool.query(
    `${DOCUMENT_SELECT}
     WHERE d.firm_id = $1 AND d.id = $2 AND d.is_deleted = FALSE
     GROUP BY d.id, u.full_name, u.initials, c.case_name, fo.category`,
    [firmId, docId]
  );
  return normalizeDocumentRow(rows[0]) || null;
}

async function insertDocument(doc) {
  const { rows } = await pool.query(
    `INSERT INTO documents (
        id, firm_id, file_name, original_name, file_type, extension,
        file_size_bytes, storage_path_url, preview_path_url, case_id,
        folder_id, author_id, is_archived, is_flagged, is_deleted
     ) VALUES (
        COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14, $15
     ) RETURNING *`,
    [
      doc.id || null, doc.firm_id, doc.file_name, doc.original_name, doc.file_type, doc.extension,
      doc.file_size_bytes, doc.storage_path_url, doc.preview_path_url || null, doc.case_id || null,
      doc.folder_id || null, doc.author_id || null, doc.is_archived || false, doc.is_flagged || false, doc.is_deleted || false
    ]
  );
  const inserted = rows[0];
  if (doc.tags && doc.tags.length) {
    await setDocumentTags(inserted.id, doc.firm_id, doc.tags);
  }
  return getDocumentById(doc.firm_id, inserted.id);
}

async function updateDocument(firmId, docId, updates) {
  const setClauses = [];
  const values = [];
  let i = 1;

  // `category` is intentionally not settable directly — it's derived from
  // the document's folder (see DOCUMENT_SELECT's join to `folders`), so
  // moving a document via `folder_id` is what changes its category.
  const fieldMap = {
    file_name: 'file_name',
    folder_id: 'folder_id',
    is_flagged: 'is_flagged',
    is_archived: 'is_archived'
  };

  for (const [key, column] of Object.entries(fieldMap)) {
    if (updates[key] !== undefined) {
      setClauses.push(`${column} = $${i}`);
      values.push(updates[key]);
      i += 1;
    }
  }

  if (setClauses.length) {
    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(firmId, docId);
    await pool.query(
      `UPDATE documents SET ${setClauses.join(', ')} WHERE firm_id = $${i} AND id = $${i + 1}`,
      values
    );
  }

  if (updates.tags && Array.isArray(updates.tags)) {
    await setDocumentTags(docId, firmId, updates.tags);
  }

  return getDocumentById(firmId, docId);
}

async function softDeleteDocument(firmId, docId) {
  await pool.query(
    `UPDATE documents SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
     WHERE firm_id = $1 AND id = $2`,
    [firmId, docId]
  );
}

// ── Document shares ──────────────────────────────────────────────────────
async function insertShare({ documentId, sharedBy, recipientEmail, shareToken, permission, expiresAt }) {
  const { rows } = await pool.query(
    `INSERT INTO document_shares (document_id, shared_by, recipient_email, share_token, permission, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [documentId, sharedBy, recipientEmail, shareToken, permission, expiresAt]
  );
  return rows[0];
}

// ── Audit logs ───────────────────────────────────────────────────────────
async function insertAuditLog({ firmId, userId, documentId, folderId, action, ipAddress, userAgent, details }) {
  await pool.query(
    `INSERT INTO audit_logs (firm_id, user_id, document_id, folder_id, action, ip_address, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [firmId, userId || null, documentId || null, folderId || null, action, ipAddress || null, userAgent || null, details || {}]
  );
}

// ── Client messages / case deadlines (widget data) ──────────────────────
async function listClientMessages(firmId) {
  const { rows } = await pool.query(
    'SELECT * FROM client_messages WHERE firm_id = $1 ORDER BY created_at DESC',
    [firmId]
  );
  return rows;
}

async function insertClientMessage({ firmId, clientName, clientAvatar, subject, preview, timestampText, isUnread, isUrgent, attachmentName, attachmentSize, attachmentDocId }) {
  const { rows } = await pool.query(
    `INSERT INTO client_messages (
        firm_id, client_name, client_avatar, subject, preview, timestamp_text,
        is_unread, is_urgent, attachment_name, attachment_size, attachment_doc_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [firmId, clientName, clientAvatar, subject, preview, timestampText, isUnread, isUrgent, attachmentName || null, attachmentSize || null, attachmentDocId || null]
  );
  return rows[0];
}

async function listCaseDeadlines(firmId) {
  const { rows } = await pool.query(
    'SELECT * FROM case_deadlines WHERE firm_id = $1 ORDER BY deadline_date ASC',
    [firmId]
  );
  return rows;
}

module.exports = {
  pool,
  DEFAULT_FIRM_ID,
  DEFAULT_USER_ID,
  getFirmById,
  getUserByEmail,
  getUserById,
  getUserByIdAndFirm,
  listUsersByFirm,
  createUser,
  getStorageQuota,
  ensureStorageQuota,
  listFolders,
  insertFolder,
  getFolderById,
  updateFolder,
  deleteFolder,
  ensureCase,
  setDocumentTags,
  listActiveDocuments,
  getDocumentById,
  insertDocument,
  updateDocument,
  softDeleteDocument,
  insertShare,
  insertAuditLog,
  listClientMessages,
  insertClientMessage,
  listCaseDeadlines
};
