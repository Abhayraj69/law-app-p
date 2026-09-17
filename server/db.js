const { pool } = require('./db/pool');

// Postgres rejects a non-UUID string against a UUID column with a hard
// error (22P02), not an empty result set — so an id lookup fed a garbage or
// unrelated-format id (e.g. a case's text id passed where a document id was
// expected, or a caller just guessing) would 500 instead of behaving like
// any other "not found". Checked before querying wherever an id is looked
// up against a UUID primary key so that case looks the same as a
// well-formed-but-nonexistent id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

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

// Stable seed identifier, reused by the seed script and by tests.
const DEFAULT_FIRM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

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

// ── Admin-invite user provisioning ──────────────────────────────────────
//
// Unlike createUser (which upserts on email conflict — needed so the
// `npm run seed` script stays re-runnable), this deliberately does NOT
// overwrite an existing account: ON CONFLICT DO NOTHING, and the caller
// (inviteService) checks whether a row actually came back to distinguish
// "created" from "email already taken" and return a proper 409.
async function createInvitedUser({ firmId, email, fullName, role, initials, placeholderPasswordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (firm_id, email, full_name, role, initials, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING
     RETURNING *`,
    [firmId, email, fullName, role, initials || null, placeholderPasswordHash]
  );
  return rows[0] || null;
}

async function createUserInvite({ firmId, userId, invitedBy, tokenHash, expiresAt }) {
  const { rows } = await pool.query(
    `INSERT INTO user_invites (firm_id, user_id, invited_by, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [firmId, userId, invitedBy || null, tokenHash, expiresAt]
  );
  return rows[0];
}

// Returns the invite + the user it will activate, but ONLY if it hasn't
// expired and hasn't already been accepted — an expired or spent token
// must behave exactly like "doesn't exist" to the caller, not like a
// valid-but-flagged one, so there's nothing for a caller to branch on
// that would distinguish "wrong token" from "right token, too late".
async function getUsableInviteByTokenHash(tokenHash) {
  const { rows } = await pool.query(
    `SELECT ui.*, u.email, u.full_name, u.role, u.initials
     FROM user_invites ui
     JOIN users u ON u.id = ui.user_id
     WHERE ui.token_hash = $1
       AND ui.accepted_at IS NULL
       AND ui.expires_at > CURRENT_TIMESTAMP`,
    [tokenHash]
  );
  return rows[0] || null;
}

// Sets the invitee's own chosen password and marks the invite spent, in
// one transaction — a token must not be usable twice even under a race
// (two requests accepting the same invite at once).
async function acceptUserInvite(inviteId, userId, passwordHash) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE user_invites SET accepted_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND accepted_at IS NULL`,
      [inviteId]
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return false; // already accepted by a concurrent request
    }
    await client.query(
      `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [passwordHash, userId]
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Roster view for the admin "Team Members" panel: every user in the firm,
// with their invite status (accepted / pending / expired) if they were
// invited through this flow at all (seed-script users have no invite row
// and are just reported as accepted).
async function listUsersWithInviteStatus(firmId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.role, u.initials, u.created_at,
            ui.expires_at AS invite_expires_at,
            ui.accepted_at AS invite_accepted_at
     FROM users u
     LEFT JOIN LATERAL (
       SELECT expires_at, accepted_at FROM user_invites
       WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
     ) ui ON true
     WHERE u.firm_id = $1
     ORDER BY u.created_at DESC`,
    [firmId]
  );
  return rows.map(r => ({
    ...r,
    invite_status: !r.invite_expires_at ? 'active' // no invite row at all (seeded directly)
      : r.invite_accepted_at ? 'active'
      : new Date(r.invite_expires_at) < new Date() ? 'expired'
      : 'pending'
  }));
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

// Admin-facing quota edit (Settings > Storage). Upserts rather than assuming
// a row already exists — a firm that has never uploaded anything (and so
// never hit ensureStorageQuota via the upload path) can still have its
// limit raised in advance.
async function updateStorageQuotaLimit(firmId, limitBytes) {
  const { rows } = await pool.query(
    `INSERT INTO storage_quotas (firm_id, storage_limit_bytes, storage_used_bytes)
     VALUES ($1, $2, 0)
     ON CONFLICT (firm_id) DO UPDATE SET
       storage_limit_bytes = EXCLUDED.storage_limit_bytes,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [firmId, limitBytes]
  );
  return rows[0];
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
  if (!isUuid(firmId) || !isUuid(folderId)) return null;
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

// Same rule as scopeCasesToUser: a CLIENT only ever sees documents whose
// case is theirs (via the `c` alias's client_user_id, joined in
// DOCUMENT_SELECT). A document with no case_id (c.client_user_id is then
// NULL) can therefore never match a CLIENT and is correctly hidden.
// `user` is optional — omitting it (as firm-wide staff views like vault
// stats do) applies no filter, matching pre-existing behavior.
function scopeDocumentsToUser(query, values, user) {
  if (user && user.role === 'CLIENT') {
    values.push(user.id);
    return `${query} AND c.client_user_id = $${values.length}`;
  }
  return query;
}

async function listActiveDocuments(firmId, user) {
  const values = [firmId];
  let query = `${DOCUMENT_SELECT} WHERE d.firm_id = $1 AND d.is_deleted = FALSE`;
  query = scopeDocumentsToUser(query, values, user);
  query += ' GROUP BY d.id, u.full_name, u.initials, c.case_name, fo.category';
  const { rows } = await pool.query(query, values);
  return rows.map(normalizeDocumentRow);
}

async function getDocumentById(firmId, docId, user) {
  if (!isUuid(firmId) || !isUuid(docId)) return null;
  const values = [firmId, docId];
  let query = `${DOCUMENT_SELECT} WHERE d.firm_id = $1 AND d.id = $2 AND d.is_deleted = FALSE`;
  query = scopeDocumentsToUser(query, values, user);
  query += ' GROUP BY d.id, u.full_name, u.initials, c.case_name, fo.category';
  const { rows } = await pool.query(query, values);
  return normalizeDocumentRow(rows[0]) || null;
}

// Backs the vault's Tag filter dropdown — the real, currently-in-use set
// of tag names for this firm, rather than a hardcoded guess in the
// frontend that would drift from whatever tags actually get applied.
async function listDistinctDocumentTags(firmId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT t.name
     FROM tags t
     JOIN document_tags dt ON dt.tag_id = t.id
     JOIN documents d ON d.id = dt.document_id
     WHERE d.firm_id = $1 AND d.is_deleted = FALSE
     ORDER BY t.name`,
    [firmId]
  );
  return rows.map(r => r.name);
}

// GET /api/v1/cases/:id/documents — the client portal's document list.
// Ownership of the case itself must already be verified by the caller
// (CaseService.getCase, which applies scopeCasesToUser) before calling
// this; it does no scoping of its own beyond firm_id + case_id.
async function listDocumentsByCase(firmId, caseId) {
  const { rows } = await pool.query(
    `${DOCUMENT_SELECT}
     WHERE d.firm_id = $1 AND d.case_id = $2 AND d.is_deleted = FALSE
     GROUP BY d.id, u.full_name, u.initials, c.case_name, fo.category
     ORDER BY d.updated_at DESC`,
    [firmId, caseId]
  );
  return rows.map(normalizeDocumentRow);
}

async function insertDocument(doc) {
  const { rows } = await pool.query(
    `INSERT INTO documents (
        id, firm_id, file_name, original_name, file_type, extension,
        file_size_bytes, storage_path_url, preview_path_url, case_id,
        folder_id, author_id, is_archived, is_flagged, is_deleted, sha256
     ) VALUES (
        COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16
     ) RETURNING *`,
    [
      doc.id || null, doc.firm_id, doc.file_name, doc.original_name, doc.file_type, doc.extension,
      doc.file_size_bytes, doc.storage_path_url, doc.preview_path_url || null, doc.case_id || null,
      doc.folder_id || null, doc.author_id || null, doc.is_archived || false, doc.is_flagged || false, doc.is_deleted || false,
      doc.sha256 || null
    ]
  );
  const inserted = rows[0];
  if (doc.tags && doc.tags.length) {
    await setDocumentTags(inserted.id, doc.firm_id, doc.tags);
  }
  return getDocumentById(doc.firm_id, inserted.id);
}

// Backs upload-time duplicate detection (see VaultService.initiateUpload)
// — finds an existing, non-deleted document with byte-identical content
// in this firm, optionally narrowed to one case/folder so a firm-wide
// content match doesn't block re-using a common template across cases.
async function findDocumentBySha256(firmId, sha256, { caseId, folderId } = {}) {
  const values = [firmId, sha256];
  let query = `${DOCUMENT_SELECT} WHERE d.firm_id = $1 AND d.sha256 = $2 AND d.is_deleted = FALSE`;
  if (caseId) {
    values.push(caseId);
    query += ` AND d.case_id = $${values.length}`;
  }
  if (folderId) {
    values.push(folderId);
    query += ` AND d.folder_id = $${values.length}`;
  }
  query += ' GROUP BY d.id, u.full_name, u.initials, c.case_name, fo.category ORDER BY d.created_at ASC LIMIT 1';
  const { rows } = await pool.query(query, values);
  return normalizeDocumentRow(rows[0]) || null;
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

// ── Document versions ────────────────────────────────────────────────────
// Deliberately append-only from this module's own perspective too — there
// is no updateDocumentVersion/deleteDocumentVersion here, matching
// FileService: a document's version history can only ever grow via
// insertDocumentVersionAndPromote below.
async function listDocumentVersions(firmId, docId) {
  const { rows } = await pool.query(
    `SELECT v.*, u.full_name AS uploaded_by_name
     FROM document_versions v
     JOIN documents d ON d.id = v.document_id
     LEFT JOIN users u ON u.id = v.uploaded_by
     WHERE d.firm_id = $1 AND v.document_id = $2
     ORDER BY v.version_number DESC`,
    [firmId, docId]
  );
  return rows.map(r => ({ ...r, file_size_bytes: Number(r.file_size_bytes) }));
}

// A brand-new document's first version row — plain insert, no side
// effects on `documents`/quota needed (insertDocument's own INSERT already
// set the right file_size_bytes/storage_path_url and already tripped the
// quota trigger). Called once, right after insertDocument, so every
// document has a complete version history from the moment it exists
// rather than only gaining one on its first re-upload.
async function insertInitialDocumentVersion({ documentId, storagePathUrl, originalName, fileType, fileSizeBytes, uploadedBy }) {
  await pool.query(
    `INSERT INTO document_versions (document_id, version_number, storage_path_url, original_name, file_type, file_size_bytes, uploaded_by)
     VALUES ($1, 1, $2, $3, $4, $5, $6)
     ON CONFLICT (document_id, version_number) DO NOTHING`,
    [documentId, storagePathUrl, originalName, fileType, fileSizeBytes, uploadedBy || null]
  );
}

async function getDocumentVersionById(firmId, docId, versionId) {
  const { rows } = await pool.query(
    `SELECT v.* FROM document_versions v
     JOIN documents d ON d.id = v.document_id
     WHERE d.firm_id = $1 AND v.document_id = $2 AND v.id = $3`,
    [firmId, docId, versionId]
  );
  if (!rows[0]) return null;
  return { ...rows[0], file_size_bytes: Number(rows[0].file_size_bytes) };
}

// Same as getDocumentVersionById but addressed by version_number — used by
// the version-compare endpoint, where the URL references versions the same
// human-readable way the Version History table already displays them
// ("v1", "v3", ...) rather than an internal UUID the user never sees.
async function getDocumentVersionByNumber(firmId, docId, versionNumber) {
  const { rows } = await pool.query(
    `SELECT v.*, u.full_name AS uploaded_by_name FROM document_versions v
     JOIN documents d ON d.id = v.document_id
     LEFT JOIN users u ON u.id = v.uploaded_by
     WHERE d.firm_id = $1 AND v.document_id = $2 AND v.version_number = $3`,
    [firmId, docId, versionNumber]
  );
  if (!rows[0]) return null;
  return { ...rows[0], file_size_bytes: Number(rows[0].file_size_bytes) };
}

// Inserts the new version row, repoints `documents` at it (so every
// existing read path — preview, download, listing — keeps serving "the
// current version" with no changes of its own), and bumps the firm's
// storage quota by the new version's size, all in one transaction. See
// migration 0016's header comment on why the quota bump has to be done
// here explicitly rather than left to trigger_document_storage_quota.
async function insertDocumentVersionAndPromote({
  firmId, documentId, versionNumber, storagePathUrl, originalName, fileType, fileSizeBytes, uploadedBy, comment
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const versionResult = await client.query(
      `INSERT INTO document_versions (document_id, version_number, storage_path_url, original_name, file_type, file_size_bytes, uploaded_by, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [documentId, versionNumber, storagePathUrl, originalName, fileType, fileSizeBytes, uploadedBy || null, comment || null]
    );
    await client.query(
      `UPDATE documents SET
          file_name = $1, original_name = $1, file_type = $2,
          extension = $3, file_size_bytes = $4, storage_path_url = $5,
          version = $6, updated_at = CURRENT_TIMESTAMP
       WHERE firm_id = $7 AND id = $8`,
      [
        originalName, fileType, (originalName.split('.').pop() || '').toLowerCase(),
        fileSizeBytes, storagePathUrl, versionNumber, firmId, documentId
      ]
    );
    await client.query(
      `UPDATE storage_quotas SET storage_used_bytes = storage_used_bytes + $1, updated_at = CURRENT_TIMESTAMP
       WHERE firm_id = $2`,
      [fileSizeBytes, firmId]
    );
    await client.query('COMMIT');
    const v = versionResult.rows[0];
    return { ...v, file_size_bytes: Number(v.file_size_bytes) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

// Settings > Audit Log admin viewer. Filters are all optional and AND'd
// together; dateFrom/dateTo are date-only strings ('YYYY-MM-DD') compared
// against the full created_at timestamp — dateTo is treated as inclusive
// of that whole calendar day (< dateTo + 1 day), not truncated to midnight.
function buildAuditLogFilter(firmId, { userId, action, dateFrom, dateTo }) {
  const conditions = ['a.firm_id = $1'];
  const params = [firmId];
  if (userId) conditions.push(`a.user_id = $${params.push(userId)}`);
  if (action) conditions.push(`a.action = $${params.push(action)}`);
  if (dateFrom) conditions.push(`a.created_at >= $${params.push(dateFrom)}::date`);
  if (dateTo) conditions.push(`a.created_at < $${params.push(dateTo)}::date + interval '1 day'`);
  return { where: conditions.join(' AND '), params };
}

async function listAuditLogsForFirm(firmId, filters, limit, offset) {
  const { where, params } = buildAuditLogFilter(firmId, filters);
  const limitIdx = params.push(limit);
  const offsetIdx = params.push(offset);
  const { rows } = await pool.query(
    `SELECT a.id, a.action::text AS action, a.created_at, a.details, a.ip_address,
            u.full_name AS user_name, u.email AS user_email,
            d.file_name AS document_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN documents d ON d.id = a.document_id
     WHERE ${where}
     ORDER BY a.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  return rows;
}

async function countAuditLogsForFirm(firmId, filters) {
  const { where, params } = buildAuditLogFilter(firmId, filters);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM audit_logs a WHERE ${where}`,
    params
  );
  return rows[0].n;
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

async function insertCaseDeadline({ firmId, caseId, title, location, deadlineDate, timeText, badgeType, badgeColor }) {
  const { rows } = await pool.query(
    `INSERT INTO case_deadlines (firm_id, case_id, title, location, deadline_date, time_text, badge_type, badge_color)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [firmId, caseId, title, location || null, deadlineDate, timeText || null, badgeType || 'Hearing', badgeColor || '#C9A84C']
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

// GET /api/v1/cases/:id/deadlines — the client portal's hearing schedule.
// Same convention as listDocumentsByCase: ownership of the case itself
// must already be verified by the caller (CaseService.getCase, via
// scopeCasesToUser) before this runs; it does no scoping of its own
// beyond firm_id + case_id.
async function listDeadlinesByCase(firmId, caseId) {
  const { rows } = await pool.query(
    'SELECT * FROM case_deadlines WHERE firm_id = $1 AND case_id = $2 ORDER BY deadline_date ASC',
    [firmId, caseId]
  );
  return rows;
}

// ── Cases (full CRUD backing the Active Cases page) ─────────────────────
//
// `client_user_id` is how role scoping works: a CLIENT-role user only ever
// sees cases where this column matches their own id. Callers pass the
// requesting `user` object in; every function here applies that filter
// itself rather than trusting the caller to have already scoped the rows,
// so a missing filter upstream can't leak another client's case.
function scopeCasesToUser(query, values, user, alias = 'cases') {
  if (user && user.role === 'CLIENT') {
    values.push(user.id);
    return `${query} AND ${alias}.client_user_id = $${values.length}`;
  }
  return query;
}

// The Active Cases table shows each case's next hearing, which lives in
// case_deadlines — pulled here as a correlated subquery so listing N cases
// stays one round trip instead of N+1.
const CASE_SELECT = `
  SELECT cases.*,
         u.full_name AS lead_attorney_name,
         u.initials AS lead_attorney_initials,
         (SELECT cd.deadline_date FROM case_deadlines cd
           WHERE cd.case_id = cases.id AND cd.deadline_date >= CURRENT_DATE
           ORDER BY cd.deadline_date ASC LIMIT 1) AS next_hearing_date
  FROM cases
  LEFT JOIN users u ON u.id = cases.lead_attorney_id
`;

async function listCasesForUser(firmId, user) {
  const values = [firmId];
  let query = `${CASE_SELECT} WHERE cases.firm_id = $1`;
  query = scopeCasesToUser(query, values, user);
  query += ' ORDER BY cases.updated_at DESC';
  const { rows } = await pool.query(query, values);
  return rows;
}

async function getCaseByIdForUser(firmId, caseId, user) {
  const values = [firmId, caseId];
  let query = `${CASE_SELECT} WHERE cases.firm_id = $1 AND cases.id = $2`;
  query = scopeCasesToUser(query, values, user);
  const { rows } = await pool.query(query, values);
  return rows[0] || null;
}

async function insertCase({ id, firmId, caseName, clientName, opposingParty, opposingCounsel, status, leadAttorneyId, caseType, clientUserId, description, relatedEntities }) {
  const { rows } = await pool.query(
    `INSERT INTO cases (id, firm_id, case_name, client_name, opposing_party, opposing_counsel, status, lead_attorney_id, case_type, client_user_id, description, related_entities)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'active'), $8, $9, $10, $11, COALESCE($12::text[], '{}'))
     RETURNING *`,
    [id, firmId, caseName, clientName, opposingParty || null, opposingCounsel || null, status || null, leadAttorneyId || null, caseType || null, clientUserId || null, description || null, relatedEntities || null]
  );
  return rows[0];
}

async function updateCaseStatus(firmId, caseId, status) {
  const { rows } = await pool.query(
    `UPDATE cases SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE firm_id = $2 AND id = $3
     RETURNING *`,
    [status, firmId, caseId]
  );
  return rows[0] || null;
}

// General field update (status, lead attorney, opposing party/counsel,
// case type) — distinct from the narrow updateCaseStatus above (kept as
// the dedicated path for the "Archive Case" UI action). Only fields
// actually present in `updates` are changed; anything else on the row is
// left alone. Used by the AI Copilot's createOrUpdateCase tool.
async function updateCaseFields(firmId, caseId, updates = {}) {
  const fieldMap = {
    status: 'status',
    leadAttorneyId: 'lead_attorney_id',
    opposingParty: 'opposing_party',
    opposingCounsel: 'opposing_counsel',
    caseType: 'case_type',
    description: 'description'
  };

  const setClauses = [];
  const values = [];
  let i = 1;
  for (const [key, column] of Object.entries(fieldMap)) {
    if (updates[key] !== undefined) {
      setClauses.push(`${column} = $${i}`);
      values.push(updates[key]);
      i += 1;
    }
  }
  if (!setClauses.length) return getCaseByIdForUser(firmId, caseId, null);

  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  values.push(firmId, caseId);
  await pool.query(
    `UPDATE cases SET ${setClauses.join(', ')} WHERE firm_id = $${i} AND id = $${i + 1}`,
    values
  );
  return getCaseByIdForUser(firmId, caseId, null);
}

// Case-insensitive EXACT match on case_name (not a substring/fuzzy
// search) — used to resolve a case by name when a caller-supplied
// case_id doesn't match any real row. Deliberately exact rather than
// ILIKE '%name%': a substring search would almost always return more
// than one hit in a real firm's case list, making "is this ambiguous"
// meaningless. Returns an array since a firm CAN legitimately have two
// differently-numbered cases with the same name — callers must treat
// more than one result as ambiguous, not just take the first.
async function findCasesByExactName(firmId, name) {
  const { rows } = await pool.query(
    `${CASE_SELECT} WHERE cases.firm_id = $1 AND LOWER(cases.case_name) = LOWER($2)`,
    [firmId, name]
  );
  return rows;
}

// Every case's party-name fields for a firm, across ALL statuses (including
// closed) — conflict-of-interest history doesn't expire just because a case
// closed. Deliberately narrow (no joins, no CASE_SELECT) since
// ConflictCheckService only ever reads these four columns per case.
async function listCasePartiesForFirm(firmId) {
  const { rows } = await pool.query(
    `SELECT id, case_name, client_name, opposing_party, opposing_counsel, related_entities
     FROM cases WHERE firm_id = $1`,
    [firmId]
  );
  return rows;
}

// Highest existing numeric suffix of a case id like 'LC-2026-014', used to
// generate the next id when creating a case from the UI.
async function getMaxCaseNumber(firmId) {
  const { rows } = await pool.query(
    `SELECT id FROM cases WHERE firm_id = $1 AND id ~ '^LC-[0-9]{4}-[0-9]+$' ORDER BY id DESC`,
    [firmId]
  );
  let max = 0;
  for (const row of rows) {
    const n = parseInt(row.id.split('-')[2], 10);
    if (n > max) max = n;
  }
  return max;
}

// ── Case Intake (matter-opening workflow) ────────────────────────────────
// Deliberately separate from the case functions above — see migration
// 0015's header comment for why this lives in its own table rather than
// new columns on `cases`. A case with no case_intake row (every case that
// existed before this migration, and any created without the "Start
// Matter Intake" flow) is simply outside this workflow entirely.

async function insertCaseIntake({ caseId, firmId, state, conflictMatches }) {
  const { rows } = await pool.query(
    `INSERT INTO case_intake (case_id, firm_id, state, conflict_check_matches)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [caseId, firmId, state, JSON.stringify(conflictMatches || [])]
  );
  return rows[0];
}

async function getCaseIntake(firmId, caseId) {
  const { rows } = await pool.query(
    `SELECT * FROM case_intake WHERE firm_id = $1 AND case_id = $2`,
    [firmId, caseId]
  );
  return rows[0] || null;
}

// General field update, same pattern as updateCaseFields — only keys
// actually present in `updates` are changed. `state` is always included
// by callers (every intake transition changes state); the rest are
// per-transition payload (conflict override reason, document ids, etc).
async function updateCaseIntake(firmId, caseId, updates = {}) {
  const fieldMap = {
    state: 'state',
    conflictOverrideBy: 'conflict_override_by',
    conflictOverrideReason: 'conflict_override_reason',
    engagementLetterDocumentId: 'engagement_letter_document_id',
    engagementLetterSentAt: 'engagement_letter_sent_at',
    signedDocumentId: 'signed_document_id',
    signedAt: 'signed_at',
    retainerTransactionId: 'retainer_transaction_id',
    retainerWaived: 'retainer_waived',
    retainerWaivedReason: 'retainer_waived_reason',
    activatedAt: 'activated_at',
    activatedBy: 'activated_by',
    declinedAt: 'declined_at',
    declinedReason: 'declined_reason'
  };

  const setClauses = [];
  const values = [];
  let i = 1;
  for (const [key, column] of Object.entries(fieldMap)) {
    if (updates[key] !== undefined) {
      setClauses.push(`${column} = $${i}`);
      values.push(updates[key]);
      i += 1;
    }
  }
  if (!setClauses.length) return getCaseIntake(firmId, caseId);

  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  values.push(firmId, caseId);
  const { rows } = await pool.query(
    `UPDATE case_intake SET ${setClauses.join(', ')} WHERE firm_id = $${i} AND case_id = $${i + 1} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function insertCaseIntakeEvent({ caseId, fromState, toState, actorId, note }) {
  const { rows } = await pool.query(
    `INSERT INTO case_intake_events (case_id, from_state, to_state, actor_id, note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [caseId, fromState || null, toState, actorId || null, note || null]
  );
  return rows[0];
}

async function listCaseIntakeEvents(caseId) {
  const { rows } = await pool.query(
    `SELECT e.*, u.full_name AS actor_name
     FROM case_intake_events e
     LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.case_id = $1
     ORDER BY e.created_at ASC`,
    [caseId]
  );
  return rows;
}

// Activation flips both case_intake.state and cases.status together —
// they must never disagree (an "ACTIVATED" intake with a case still
// 'pending', or vice versa, would be exactly the kind of silent
// inconsistency this whole workflow exists to prevent). Same
// two-tables-in-one-transaction pattern as
// insertTrustTransferAndMarkInvoicePaid.
async function activateCaseIntake(firmId, caseId, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const intakeResult = await client.query(
      `UPDATE case_intake SET state = 'ACTIVATED', activated_at = CURRENT_TIMESTAMP, activated_by = $1, updated_at = CURRENT_TIMESTAMP
       WHERE firm_id = $2 AND case_id = $3 AND state = 'RETAINER_RECEIVED'
       RETURNING *`,
      [actorId, firmId, caseId]
    );
    if (intakeResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `UPDATE cases SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE firm_id = $1 AND id = $2`,
      [firmId, caseId]
    );
    await client.query('COMMIT');
    return intakeResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Invoices ─────────────────────────────────────────────────────────────
const INVOICE_SELECT = `SELECT invoices.*, cases.case_name FROM invoices
     LEFT JOIN cases ON cases.id = invoices.case_id`;

async function listInvoicesByFirm(firmId) {
  const { rows } = await pool.query(
    `${INVOICE_SELECT}
     WHERE invoices.firm_id = $1
     ORDER BY invoices.issued_date DESC`,
    [firmId]
  );
  return rows.map(r => ({ ...r, amount_cents: Number(r.amount_cents) }));
}

// GET (single)/PATCH /api/v1/invoices/:id — firm-scoped, not further
// scoped by user: unlike listInvoicesForUser (the client portal's read),
// create/update/markPaid are staff-only actions gated by requireRole in
// server/routes/api.js, so there's no CLIENT case to restrict here.
async function getInvoiceById(firmId, invoiceId) {
  const { rows } = await pool.query(
    `${INVOICE_SELECT} WHERE invoices.firm_id = $1 AND invoices.id = $2`,
    [firmId, invoiceId]
  );
  if (!rows[0]) return null;
  return { ...rows[0], amount_cents: Number(rows[0].amount_cents) };
}

// Highest existing numeric suffix of an invoice_number like
// 'INV-2026-084', used to generate the next one when creating an invoice
// from the UI — same convention as getMaxCaseNumber for case ids.
async function getMaxInvoiceNumber(firmId) {
  const { rows } = await pool.query(
    `SELECT invoice_number FROM invoices WHERE firm_id = $1 AND invoice_number ~ '^INV-[0-9]{4}-[0-9]+$' ORDER BY invoice_number DESC`,
    [firmId]
  );
  let max = 0;
  for (const row of rows) {
    const n = parseInt(row.invoice_number.split('-')[2], 10);
    if (n > max) max = n;
  }
  return max;
}

async function insertInvoice({ id, firmId, caseId, invoiceNumber, amountCents, status, issuedDate, dueDate }) {
  const { rows } = await pool.query(
    `INSERT INTO invoices (id, firm_id, case_id, invoice_number, amount_cents, status, issued_date, due_date)
     VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, COALESCE($6, 'draft'), COALESCE($7, CURRENT_DATE), $8)
     RETURNING id`,
    [id || null, firmId, caseId || null, invoiceNumber, amountCents, status || null, issuedDate || null, dueDate || null]
  );
  return getInvoiceById(firmId, rows[0].id);
}

// General field update (case, amount, due date, non-paid status changes).
// Deliberately excludes `status = 'paid'` and `paid_date` — those only ever
// go through markInvoicePaid below, the same way archiveCase is a separate
// dedicated action from updateCaseFields rather than a status value any
// generic update can set.
async function updateInvoiceFields(firmId, invoiceId, updates = {}) {
  const fieldMap = {
    caseId: 'case_id',
    amountCents: 'amount_cents',
    status: 'status',
    dueDate: 'due_date'
  };

  const setClauses = [];
  const values = [];
  let i = 1;
  for (const [key, column] of Object.entries(fieldMap)) {
    if (updates[key] !== undefined) {
      setClauses.push(`${column} = $${i}`);
      values.push(updates[key]);
      i++;
    }
  }
  if (!setClauses.length) return getInvoiceById(firmId, invoiceId);

  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  values.push(firmId, invoiceId);
  await pool.query(
    `UPDATE invoices SET ${setClauses.join(', ')} WHERE firm_id = $${i} AND id = $${i + 1}`,
    values
  );
  return getInvoiceById(firmId, invoiceId);
}

// Used by the "Mark Paid" action — sets status to 'paid' and stamps
// paid_date (defaults to today, same as issued_date's own column default,
// but taken explicitly here since CURRENT_DATE in an UPDATE isn't a column
// default).
async function markInvoicePaidRow(firmId, invoiceId, paidDate) {
  const { rows } = await pool.query(
    `UPDATE invoices SET status = 'paid', paid_date = COALESCE($1, CURRENT_DATE), updated_at = CURRENT_TIMESTAMP
     WHERE firm_id = $2 AND id = $3
     RETURNING id`,
    [paidDate || null, firmId, invoiceId]
  );
  if (!rows[0]) return null;
  return getInvoiceById(firmId, invoiceId);
}

// GET /api/v1/invoices — the client portal's billing view. Same
// client_user_id scoping rule as cases/documents: a CLIENT only ever sees
// invoices billed against one of their own cases. An invoice with no
// case_id (cases.client_user_id then NULL) can never match a CLIENT.
async function listInvoicesForUser(firmId, user) {
  const values = [firmId];
  let query = `SELECT invoices.*, cases.case_name FROM invoices
     LEFT JOIN cases ON cases.id = invoices.case_id
     WHERE invoices.firm_id = $1`;
  if (user && user.role === 'CLIENT') {
    values.push(user.id);
    query += ` AND cases.client_user_id = $${values.length}`;
  }
  query += ' ORDER BY invoices.issued_date DESC';
  const { rows } = await pool.query(query, values);
  return rows.map(r => ({ ...r, amount_cents: Number(r.amount_cents) }));
}

// Monthly totals for the billing chart plus overdue invoice stats for the
// dashboard KPI card. Done as two small queries rather than pulling every
// invoice row and summing in JS, since this is meant to scale with real
// invoice volume.
async function getMonthlyBillingTotals(firmId, months = 7) {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('month', issued_date), 'Mon') AS month,
            date_trunc('month', issued_date) AS month_start,
            SUM(amount_cents)::bigint AS total_cents
     FROM invoices
     WHERE firm_id = $1 AND status IN ('paid', 'sent', 'overdue')
       AND issued_date >= (CURRENT_DATE - ($2 || ' months')::interval)
     GROUP BY 1, 2
     ORDER BY 2 ASC`,
    [firmId, months]
  );
  return rows.map(r => ({ month: r.month, value: Number(r.total_cents) }));
}

async function getInvoiceStats(firmId) {
  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid' AND issued_date >= date_trunc('year', CURRENT_DATE)), 0)::bigint AS revenue_ytd_cents,
        COUNT(*) FILTER (WHERE status = 'overdue') AS overdue_count,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'overdue'), 0)::bigint AS overdue_cents
     FROM invoices WHERE firm_id = $1`,
    [firmId]
  );
  const r = rows[0];
  return {
    revenue_ytd_cents: Number(r.revenue_ytd_cents),
    overdue_count: Number(r.overdue_count),
    overdue_cents: Number(r.overdue_cents)
  };
}

// ── Conversations / threaded client communications ──────────────────────
// Same role-scoping rule as cases: a CLIENT only ever sees conversations
// where client_user_id matches their own id.
function scopeConversationsToUser(query, values, user) {
  if (user && user.role === 'CLIENT') {
    values.push(user.id);
    return `${query} AND conversations.client_user_id = $${values.length}`;
  }
  return query;
}

async function listConversationsForUser(firmId, user) {
  const values = [firmId];
  // "Unread" is relative to who's looking, not an absolute property of a
  // message: a staff viewer (Client Communications page) wants to know
  // about unread messages FROM THE CLIENT, while a client viewer (Client
  // Portal) wants to know about unread messages FROM STAFF. So the sender
  // to count is always "the other party" relative to the current viewer —
  // never hardcoded to one side — or a staff reply reads as already-read
  // to the client, and the client's own outgoing messages read as unread
  // to the client, which is exactly backwards.
  const otherPartySender = user && user.role === 'CLIENT' ? 'staff' : 'client';
  values.push(otherPartySender);
  // The last message's encrypted fields (not just its plaintext `body`,
  // which may not even be populated any more — see
  // db/migrations/0006_message_encryption.sql) come along so the service
  // layer can decrypt the preview text; this SQL layer never decrypts
  // anything itself. One LATERAL join replaces what used to be two
  // separate correlated subqueries (one for body, one for sender) now
  // that there are several encrypted columns to pull alongside them.
  let query = `SELECT conversations.*, cases.case_name,
                      lm.id AS last_message_id,
                      lm.sender AS last_message_sender,
                      lm.body AS last_message_body,
                      lm.body_ciphertext AS last_message_body_ciphertext,
                      lm.body_nonce AS last_message_body_nonce,
                      lm.body_auth_tag AS last_message_body_auth_tag,
                      lm.encryption_key_id AS last_message_encryption_key_id,
                      (SELECT COUNT(*) FROM conversation_messages cm WHERE cm.conversation_id = conversations.id
                        AND cm.is_read = FALSE AND cm.sender = $2) AS unread_count
               FROM conversations
               LEFT JOIN cases ON cases.id = conversations.case_id
               LEFT JOIN LATERAL (
                 SELECT id, sender, body, body_ciphertext, body_nonce, body_auth_tag, encryption_key_id
                 FROM conversation_messages cm
                 WHERE cm.conversation_id = conversations.id
                   ${user && user.role === 'CLIENT' ? "AND cm.sender != 'note'" : ''}
                 ORDER BY cm.created_at DESC LIMIT 1
               ) lm ON true
               WHERE conversations.firm_id = $1`;
  query = scopeConversationsToUser(query, values, user);
  query += ' ORDER BY conversations.updated_at DESC';
  const { rows } = await pool.query(query, values);
  return rows.map(r => ({ ...r, unread_count: Number(r.unread_count) }));
}

// Fetches one conversation (role-scoped) with its full message list.
// `includeNotes` is set to false by the controller for a CLIENT-role
// caller so internal staff notes are never even serialized into the
// response, not just hidden client-side.
async function getConversationWithMessages(firmId, conversationId, user, includeNotes) {
  const values = [firmId, conversationId];
  let query = `SELECT conversations.*, cases.case_name FROM conversations
               LEFT JOIN cases ON cases.id = conversations.case_id
               WHERE conversations.firm_id = $1 AND conversations.id = $2`;
  query = scopeConversationsToUser(query, values, user);
  const { rows } = await pool.query(query, values);
  const conversation = rows[0];
  if (!conversation) return null;

  let msgQuery = `SELECT cm.*, u.full_name AS sender_name,
                         ad.original_name AS attachment_name,
                         ad.file_size_bytes AS attachment_size_bytes,
                         ad.file_type AS attachment_file_type
                  FROM conversation_messages cm
                  LEFT JOIN users u ON u.id = cm.sender_user_id
                  LEFT JOIN documents ad ON ad.id = cm.attachment_document_id
                  WHERE cm.conversation_id = $1`;
  const msgValues = [conversationId];
  if (!includeNotes) {
    msgQuery += ` AND cm.sender != 'note'`;
  }
  msgQuery += ' ORDER BY cm.created_at ASC';
  const { rows: messages } = await pool.query(msgQuery, msgValues);

  return { ...conversation, messages };
}

async function insertConversation({ id, firmId, caseId, clientUserId, clientName, clientInitials, clientColor }) {
  const { rows } = await pool.query(
    `INSERT INTO conversations (id, firm_id, case_id, client_user_id, client_name, client_initials, client_color)
     VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id || null, firmId, caseId || null, clientUserId || null, clientName, clientInitials || null, clientColor || null]
  );
  return rows[0];
}

// Every NEW message is written already-encrypted — `id` is pre-generated
// by the caller (server/services/communicationsService.js), not left to
// the table's default, because the encryption AAD binds ciphertext to a
// specific (conversation_id, message id) pair and has to be computed
// BEFORE this INSERT runs (see server/services/encryption/messageCipher.js).
// There is deliberately no plaintext `body` parameter here any more — see
// db/migrations/0006_message_encryption.sql's header for the migration
// plan; legacy plaintext rows written before that migration are read via
// resolveMessageBody's fallback, never written fresh.
async function insertConversationMessage({ id, conversationId, sender, senderUserId, bodyCiphertext, bodyNonce, bodyAuthTag, encryptionKeyId, attachmentDocumentId }) {
  const { rows } = await pool.query(
    `INSERT INTO conversation_messages
       (id, conversation_id, sender, sender_user_id, body_ciphertext, body_nonce, body_auth_tag, encryption_key_id, attachment_document_id)
     VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [id || null, conversationId, sender, senderUserId || null, bodyCiphertext, bodyNonce, bodyAuthTag, encryptionKeyId, attachmentDocumentId || null]
  );
  await pool.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [conversationId]);
  return rows[0];
}

// Marks read the messages sent by "the other party" relative to who just
// opened the thread — same viewer-relative semantics as the unread_count
// in listConversationsForUser above. A staff viewer clears the client's
// unread messages; a client viewer (Client Portal) clears staff's unread
// messages. Never hardcode one side here independent of viewerIsStaff, or
// opening the thread as a client will never clear the client's own unread
// badge (it'll keep clearing the client's own outgoing messages instead).
async function markConversationRead(conversationId, viewerIsStaff) {
  const otherPartySender = viewerIsStaff ? 'client' : 'staff';
  await pool.query(
    `UPDATE conversation_messages SET is_read = TRUE WHERE conversation_id = $1 AND sender = $2`,
    [conversationId, otherPartySender]
  );
}

// ── Encryption keys (envelope encryption for message bodies) ────────────
// See server/services/encryption/ for the actual crypto and KMS/local
// provider logic — this is just the data-access layer for the
// encryption_keys table itself.
//
// Keys are scoped per (provider, firm) — see db/migrations/0008_per_firm_
// encryption_keys.sql — so one firm's key compromise, rotation, or legal
// hold never touches another firm's messages, even though every firm
// shares the same underlying KMS master key (KMS_KEY_ARN) or, in
// development, the same local master key.
async function getActiveEncryptionKey(provider, firmId) {
  const { rows } = await pool.query(
    `SELECT * FROM encryption_keys WHERE provider = $1 AND firm_id = $2 AND status = 'active'`,
    [provider, firmId]
  );
  return rows[0] || null;
}

// Looked up by id alone, no firm filter — a message's encryption_key_id
// already uniquely identifies one key, and the message itself was only
// ever reachable through a firm-scoped read in the first place (see
// scopeConversationsToUser / role scoping upstream), so there's no
// caller that has a key id without already having proven access to the
// firm it belongs to.
async function getEncryptionKeyById(id) {
  const { rows } = await pool.query('SELECT * FROM encryption_keys WHERE id = $1', [id]);
  return rows[0] || null;
}

async function insertEncryptionKey({ id, provider, firmId, kmsKeyArn, wrappedDek }) {
  const { rows } = await pool.query(
    `INSERT INTO encryption_keys (id, provider, firm_id, kms_key_arn, wrapped_dek, status)
     VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, 'active')
     RETURNING *`,
    [id || null, provider, firmId, kmsKeyArn || null, wrappedDek]
  );
  return rows[0];
}

// Marks this firm's currently-active key for this provider as retired
// (kept forever, never deleted — any message encrypted under it still
// needs this row to ever be decrypted again). A no-op if none is active,
// which is the normal case on a firm's first-ever key mint.
async function retireActiveEncryptionKeys(provider, firmId) {
  await pool.query(
    `UPDATE encryption_keys SET status = 'retired', retired_at = CURRENT_TIMESTAMP
     WHERE provider = $1 AND firm_id = $2 AND status = 'active'`,
    [provider, firmId]
  );
}

// ── Dashboard aggregates ────────────────────────────────────────────────
//
// The dashboard's four KPI tiles are counted in SQL rather than by pulling
// every case/document/message row into Node and counting there. Role
// scoping is applied to the case and conversation counts the same way the
// list queries apply it, so a CLIENT's dashboard never reports totals that
// include other clients' matters.
async function getDashboardCounts(firmId, user) {
  const isClient = !!(user && user.role === 'CLIENT');
  const clientId = isClient ? user.id : null;

  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM cases
         WHERE firm_id = $1 AND status <> 'closed'
           AND ($2::uuid IS NULL OR client_user_id = $2)) AS active_cases,
       (SELECT COUNT(*) FROM documents d
         WHERE d.firm_id = $1 AND d.is_deleted = FALSE AND d.is_flagged = TRUE
           AND ($2::uuid IS NULL OR d.case_id IN (
                 SELECT id FROM cases WHERE firm_id = $1 AND client_user_id = $2))) AS pending_documents,
       (SELECT COUNT(*) FROM conversation_messages cm
         JOIN conversations c ON c.id = cm.conversation_id
         WHERE c.firm_id = $1 AND cm.is_read = FALSE AND cm.sender <> 'staff'
           AND ($2::uuid IS NULL OR c.client_user_id = $2)) AS unread_messages`,
    [firmId, clientId]
  );

  const r = rows[0];
  return {
    active_cases: Number(r.active_cases),
    pending_documents: Number(r.pending_documents),
    unread_messages: Number(r.unread_messages)
  };
}

// The dashboard activity feed is built from the real audit trail rather
// than a fixture list, so it reflects what actually happened in the app.
// GET /api/v1/cases/:id/activity — the client portal's case timeline.
// Unions three independent sources that all end up tied to the same case
// by a different path, since audit_logs has no case_id column of its own:
//   1. Case-lifecycle events (create/archive/AI-Copilot update) — these
//      store the case id in `details->>'case_id'` and never set
//      document_id (see caseService.js's insertAuditLog calls). The
//      `document_id IS NULL` guard keeps this branch and the next one
//      mutually exclusive even though a document-scoped action (like the
//      client-upload one below) ALSO happens to record case_id in its own
//      details, for its own informational purposes — without the guard,
//      that upload would double-count via both branches.
//   2. Document events whose document's own case_id matches — covers
//      both plain UPLOAD/DELETE/etc. and AI-Copilot file actions
//      (COPILOT_MOVE/RENAME/TAG/DELETE), which set audit_logs.document_id
//      to the file they acted on.
//   3. Messages posted in this case's conversation(s). 'note' rows are
//      excluded unless `includeNotes` is true — same staff-only rule
//      CommunicationsService applies to the Messages tab itself; ownership
//      of the case (and therefore of its conversations) is still the
//      caller's responsibility (CaseService.getCaseActivity verifies it
//      via getCaseByIdForUser before this ever runs).
// Everything is cast to a common shape (id, action, created_at, details,
// actor_name, target_name) so the three branches can UNION ALL cleanly.
async function listActivityForCase(firmId, caseId, includeNotes) {
  const { rows } = await pool.query(
    `(
       SELECT a.id, a.action::text AS action, a.created_at, a.details,
              u.full_name AS actor_name, NULL::text AS target_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.firm_id = $1 AND a.document_id IS NULL AND a.details->>'case_id' = $2
     )
     UNION ALL
     (
       SELECT a.id, a.action::text AS action, a.created_at, a.details,
              u.full_name AS actor_name, d.file_name AS target_name
       FROM audit_logs a
       JOIN documents d ON d.id = a.document_id
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.firm_id = $1 AND d.case_id = $2
     )
     UNION ALL
     (
       SELECT cm.id, ('MESSAGE_' || UPPER(cm.sender::text))::text AS action, cm.created_at,
              jsonb_build_object('sender', cm.sender) AS details,
              u.full_name AS actor_name, NULL::text AS target_name
       FROM conversation_messages cm
       JOIN conversations conv ON conv.id = cm.conversation_id
       LEFT JOIN users u ON u.id = cm.sender_user_id
       WHERE conv.firm_id = $1 AND conv.case_id = $2
         AND ($3::boolean OR cm.sender::text != 'note')
     )
     ORDER BY created_at DESC`,
    [firmId, caseId, !!includeNotes]
  );
  return rows;
}

async function listRecentAuditActivity(firmId, limit = 6) {
  const { rows } = await pool.query(
    `SELECT a.id, a.action, a.created_at, a.details,
            u.full_name AS user_name,
            d.file_name AS document_name,
            c.case_name, c.id AS case_id
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN documents d ON d.id = a.document_id
     LEFT JOIN cases c ON c.id = d.case_id
     WHERE a.firm_id = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [firmId, limit]
  );
  return rows;
}

// ── Trust Accounting ─────────────────────────────────────────────────────
// Deliberately separate from the invoices functions above: nothing here is
// ever summed into invoice/revenue totals, and the only function that
// touches both trust_transactions and invoices in one transaction is
// insertTrustTransferToOperating below — the sole bridge between trust and
// operating money, gated behind TrustService.transferToOperating. None of
// this is reachable from copilotController; trust writes are staff-form
// endpoints only, never exposed as an AI tool.

// trust_transactions is append-only (see migration 0014's comment) so a
// client ledger's balance is always recomputed from it, never read off a
// stored running total. An ADJUSTMENT_REVERSAL row reverses whatever
// transaction it points to via reverses_transaction_id — its direction is
// the opposite of that original row's type, not of its own — hence the
// join to `orig` below rather than a fixed sign per type.
const TRUST_SIGNED_TXN_CTE = `
  WITH signed AS (
    SELECT t.*,
      CASE
        WHEN t.type = 'DEPOSIT' THEN t.amount_cents
        WHEN t.type IN ('DISBURSEMENT', 'TRANSFER_TO_OPERATING') THEN -t.amount_cents
        WHEN t.type = 'ADJUSTMENT_REVERSAL' THEN
          CASE orig.type
            WHEN 'DEPOSIT' THEN -t.amount_cents
            WHEN 'DISBURSEMENT' THEN t.amount_cents
            WHEN 'TRANSFER_TO_OPERATING' THEN t.amount_cents
            ELSE 0
          END
        ELSE 0
      END AS signed_amount_cents
    FROM trust_transactions t
    LEFT JOIN trust_transactions orig ON orig.id = t.reverses_transaction_id
  )
`;

async function listTrustAccounts(firmId) {
  const { rows } = await pool.query(
    `SELECT * FROM trust_accounts WHERE firm_id = $1 AND is_active = TRUE ORDER BY created_at ASC`,
    [firmId]
  );
  return rows;
}

async function getTrustAccountById(firmId, accountId) {
  const { rows } = await pool.query(
    `SELECT * FROM trust_accounts WHERE firm_id = $1 AND id = $2`,
    [firmId, accountId]
  );
  return rows[0] || null;
}

async function insertTrustAccount({ firmId, accountName, bankName, accountNumberLast4 }) {
  const { rows } = await pool.query(
    `INSERT INTO trust_accounts (firm_id, account_name, bank_name, account_number_last4)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [firmId, accountName, bankName, accountNumberLast4]
  );
  return rows[0];
}

// Every client ledger for a firm (optionally scoped to one trust account),
// each with its live balance and last-activity timestamp — backs the Trust
// Accounting page's main table.
async function listClientLedgersWithBalances(firmId, trustAccountId) {
  const values = [firmId];
  let where = 'l.firm_id = $1';
  if (trustAccountId) {
    values.push(trustAccountId);
    where += ` AND l.trust_account_id = $${values.length}`;
  }
  const { rows } = await pool.query(
    `${TRUST_SIGNED_TXN_CTE}
     SELECT l.*,
        a.account_name AS trust_account_name,
        COALESCE(s.balance_cents, 0)::bigint AS balance_cents,
        s.last_activity_at
     FROM trust_client_ledgers l
     JOIN trust_accounts a ON a.id = l.trust_account_id
     LEFT JOIN (
       SELECT client_ledger_id, SUM(signed_amount_cents) AS balance_cents, MAX(created_at) AS last_activity_at
       FROM signed GROUP BY client_ledger_id
     ) s ON s.client_ledger_id = l.id
     WHERE ${where} AND l.is_active = TRUE
     ORDER BY l.client_display_name ASC`,
    values
  );
  return rows.map(r => ({ ...r, balance_cents: Number(r.balance_cents) }));
}

async function getClientLedgerById(firmId, ledgerId) {
  const { rows } = await pool.query(
    `SELECT l.*, a.account_name AS trust_account_name
     FROM trust_client_ledgers l
     JOIN trust_accounts a ON a.id = l.trust_account_id
     WHERE l.firm_id = $1 AND l.id = $2`,
    [firmId, ledgerId]
  );
  return rows[0] || null;
}

// Balance as of right now (no asOfDate) or as of the end of a given
// calendar day — the latter is what a saved reconciliation snapshot
// recomputes against, so a reconciliation stays reproducible even as new
// transactions are posted afterward.
async function getClientLedgerBalance(ledgerId, asOfDate) {
  const values = [ledgerId];
  let dateFilter = '';
  if (asOfDate) {
    values.push(asOfDate);
    dateFilter = `AND created_at < $${values.length}::date + interval '1 day'`;
  }
  const { rows } = await pool.query(
    `${TRUST_SIGNED_TXN_CTE}
     SELECT COALESCE(SUM(signed_amount_cents), 0)::bigint AS balance_cents
     FROM signed WHERE client_ledger_id = $1 ${dateFilter}`,
    values
  );
  return Number(rows[0].balance_cents);
}

// Sum of every client ledger's balance under one trust account — the
// "sum of client ledger balances" leg of the three-way reconciliation.
async function getTrustAccountClientLedgersTotal(trustAccountId, asOfDate) {
  const values = [trustAccountId];
  let dateFilter = '';
  if (asOfDate) {
    values.push(asOfDate);
    dateFilter = `AND created_at < $${values.length}::date + interval '1 day'`;
  }
  const { rows } = await pool.query(
    `${TRUST_SIGNED_TXN_CTE}
     SELECT COALESCE(SUM(signed_amount_cents), 0)::bigint AS total_cents
     FROM signed WHERE trust_account_id = $1 ${dateFilter}`,
    values
  );
  return Number(rows[0].total_cents);
}

// The "ledger balance" leg — same total as above, just named for what it
// represents in the reconciliation (they're computed the same way because
// every trust_transactions row always belongs to exactly one client
// ledger; a pooled-account-level entry with no client ledger isn't a
// concept this schema allows, by design).
async function getTrustAccountLedgerBalance(trustAccountId, asOfDate) {
  return getTrustAccountClientLedgersTotal(trustAccountId, asOfDate);
}

async function insertClientLedger({ firmId, trustAccountId, clientDisplayName, clientUserId }) {
  const { rows } = await pool.query(
    `INSERT INTO trust_client_ledgers (firm_id, trust_account_id, client_display_name, client_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (firm_id, trust_account_id, client_display_name) DO UPDATE SET is_active = TRUE
     RETURNING *`,
    [firmId, trustAccountId, clientDisplayName, clientUserId || null]
  );
  return rows[0];
}

async function insertTrustTransaction({
  firmId, trustAccountId, clientLedgerId, caseId, type, amountCents,
  memo, checkNumber, relatedInvoiceId, reversesTransactionId, createdBy
}) {
  const { rows } = await pool.query(
    `INSERT INTO trust_transactions (
        firm_id, trust_account_id, client_ledger_id, case_id, type, amount_cents,
        memo, check_number, related_invoice_id, reverses_transaction_id, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      firmId, trustAccountId, clientLedgerId, caseId || null, type, amountCents,
      memo, checkNumber || null, relatedInvoiceId || null, reversesTransactionId || null, createdBy
    ]
  );
  return { ...rows[0], amount_cents: Number(rows[0].amount_cents) };
}

// Transfer-to-operating and marking the source invoice paid must succeed
// or fail together — a client's retainer must never be shown as debited
// while the invoice it paid stays unpaid, or vice versa.
async function insertTrustTransferAndMarkInvoicePaid({
  firmId, trustAccountId, clientLedgerId, caseId, amountCents, memo, invoiceId, createdBy, paidDate
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txnResult = await client.query(
      `INSERT INTO trust_transactions (
          firm_id, trust_account_id, client_ledger_id, case_id, type, amount_cents,
          memo, related_invoice_id, created_by
       ) VALUES ($1, $2, $3, $4, 'TRANSFER_TO_OPERATING', $5, $6, $7, $8)
       RETURNING *`,
      [firmId, trustAccountId, clientLedgerId, caseId || null, amountCents, memo, invoiceId, createdBy]
    );
    const invoiceResult = await client.query(
      `UPDATE invoices SET status = 'paid', paid_date = COALESCE($1, CURRENT_DATE), updated_at = CURRENT_TIMESTAMP
       WHERE firm_id = $2 AND id = $3
       RETURNING id`,
      [paidDate || null, firmId, invoiceId]
    );
    if (invoiceResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('COMMIT');
    return { ...txnResult.rows[0], amount_cents: Number(txnResult.rows[0].amount_cents) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listTrustTransactionsForLedger(firmId, ledgerId) {
  const { rows } = await pool.query(
    `SELECT t.*, u.full_name AS created_by_name
     FROM trust_transactions t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.firm_id = $1 AND t.client_ledger_id = $2
     ORDER BY t.created_at DESC`,
    [firmId, ledgerId]
  );
  return rows.map(r => ({ ...r, amount_cents: Number(r.amount_cents) }));
}

async function getTrustTransactionById(firmId, transactionId) {
  const { rows } = await pool.query(
    `SELECT * FROM trust_transactions WHERE firm_id = $1 AND id = $2`,
    [firmId, transactionId]
  );
  if (!rows[0]) return null;
  return { ...rows[0], amount_cents: Number(rows[0].amount_cents) };
}

async function insertTrustReconciliation({
  firmId, trustAccountId, asOfDate, bankStatementBalanceCents, ledgerBalanceCents,
  clientLedgersTotalCents, isBalanced, discrepancyCents, notes, performedBy
}) {
  const { rows } = await pool.query(
    `INSERT INTO trust_reconciliations (
        firm_id, trust_account_id, as_of_date, bank_statement_balance_cents, ledger_balance_cents,
        client_ledgers_total_cents, is_balanced, discrepancy_cents, notes, performed_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      firmId, trustAccountId, asOfDate, bankStatementBalanceCents, ledgerBalanceCents,
      clientLedgersTotalCents, isBalanced, discrepancyCents, notes || null, performedBy
    ]
  );
  const r = rows[0];
  return {
    ...r,
    bank_statement_balance_cents: Number(r.bank_statement_balance_cents),
    ledger_balance_cents: Number(r.ledger_balance_cents),
    client_ledgers_total_cents: Number(r.client_ledgers_total_cents),
    discrepancy_cents: Number(r.discrepancy_cents)
  };
}

async function listTrustReconciliations(firmId, trustAccountId) {
  const { rows } = await pool.query(
    `SELECT r.*, u.full_name AS performed_by_name
     FROM trust_reconciliations r
     LEFT JOIN users u ON u.id = r.performed_by
     WHERE r.firm_id = $1 AND r.trust_account_id = $2
     ORDER BY r.as_of_date DESC, r.created_at DESC`,
    [firmId, trustAccountId]
  );
  return rows.map(r => ({
    ...r,
    bank_statement_balance_cents: Number(r.bank_statement_balance_cents),
    ledger_balance_cents: Number(r.ledger_balance_cents),
    client_ledgers_total_cents: Number(r.client_ledgers_total_cents),
    discrepancy_cents: Number(r.discrepancy_cents)
  }));
}

// ── Signature requests (pluggable e-signature workflow) ─────────────────
// See db/migrations/0019_signature_requests.sql and
// server/services/signatureService.js for the full design. Every read
// joins the document/case/requester names a view needs, the same
// "one SELECT that already has everything a caller wants" shape
// SIGNATURE_REQUEST_SELECT below mirrors DOCUMENT_SELECT for.
const SIGNATURE_REQUEST_SELECT = `
  SELECT sr.*,
         d.original_name AS document_original_name,
         c.case_name,
         u.full_name AS requested_by_name,
         f.name AS firm_name
  FROM signature_requests sr
  LEFT JOIN documents d ON d.id = sr.document_id
  LEFT JOIN cases c ON c.id = sr.case_id
  LEFT JOIN users u ON u.id = sr.requested_by
  LEFT JOIN firms f ON f.id = sr.firm_id
`;

async function insertSignatureRequest({ firmId, caseId, documentId, requestedBy, signerName, signerEmail, provider, tokenHash, expiresAt }) {
  const { rows } = await pool.query(
    `INSERT INTO signature_requests
       (firm_id, case_id, document_id, requested_by, signer_name, signer_email, provider, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [firmId, caseId || null, documentId, requestedBy || null, signerName, signerEmail, provider, tokenHash, expiresAt]
  );
  return rows[0];
}

async function getSignatureRequestById(firmId, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(`${SIGNATURE_REQUEST_SELECT} WHERE sr.firm_id = $1 AND sr.id = $2`, [firmId, id]);
  return rows[0] || null;
}

async function listSignatureRequestsByCase(firmId, caseId) {
  const { rows } = await pool.query(
    `${SIGNATURE_REQUEST_SELECT} WHERE sr.firm_id = $1 AND sr.case_id = $2 ORDER BY sr.requested_at DESC`,
    [firmId, caseId]
  );
  return rows;
}

async function listSignatureRequestsByFirm(firmId) {
  const { rows } = await pool.query(
    `${SIGNATURE_REQUEST_SELECT} WHERE sr.firm_id = $1 ORDER BY sr.requested_at DESC`,
    [firmId]
  );
  return rows;
}

// Same "invalid token must look identical to expired/spent token" posture
// as getUsableInviteByTokenHash — only a still-pending, unexpired request
// is ever returned here.
async function getUsableSignatureRequestByTokenHash(tokenHash) {
  const { rows } = await pool.query(
    `${SIGNATURE_REQUEST_SELECT} WHERE sr.token_hash = $1 AND sr.status = 'sent' AND sr.expires_at > CURRENT_TIMESTAMP`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function updateSignatureRequestStatus(firmId, id, { status, voidedAt, voidedReason }) {
  const { rows } = await pool.query(
    `UPDATE signature_requests SET status = $1, voided_at = $2, voided_reason = $3, updated_at = CURRENT_TIMESTAMP
     WHERE firm_id = $4 AND id = $5 AND status = 'sent'
     RETURNING *`,
    [status, voidedAt || null, voidedReason || null, firmId, id]
  );
  return rows[0] || null;
}

// Race-safe: only completes a request still in 'sent' — same gated-UPDATE
// pattern as acceptUserInvite, so the same token can't be used twice by
// two concurrent submits of the public signing page.
async function completeSignatureRequest(id, { signerTypedName, signerIp, signedDocumentId }) {
  const { rows } = await pool.query(
    `UPDATE signature_requests
     SET status = 'signed', completed_at = CURRENT_TIMESTAMP,
         signer_typed_name = $1, signer_ip = $2, signed_document_id = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 AND status = 'sent'
     RETURNING *`,
    [signerTypedName, signerIp || null, signedDocumentId, id]
  );
  return rows[0] || null;
}

async function insertSignatureRequestEvent({ signatureRequestId, eventType, actorId, note }) {
  const { rows } = await pool.query(
    `INSERT INTO signature_request_events (signature_request_id, event_type, actor_id, note)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [signatureRequestId, eventType, actorId || null, note || null]
  );
  return rows[0];
}

module.exports = {
  pool,
  DEFAULT_FIRM_ID,
  getFirmById,
  getUserByEmail,
  getUserById,
  getUserByIdAndFirm,
  listUsersByFirm,
  createUser,
  getStorageQuota,
  ensureStorageQuota,
  updateStorageQuotaLimit,
  listFolders,
  insertFolder,
  getFolderById,
  updateFolder,
  deleteFolder,
  ensureCase,
  setDocumentTags,
  listActiveDocuments,
  listDistinctDocumentTags,
  getDocumentById,
  listDocumentsByCase,
  findDocumentBySha256,
  insertDocument,
  updateDocument,
  softDeleteDocument,
  listDocumentVersions,
  getDocumentVersionById,
  getDocumentVersionByNumber,
  insertInitialDocumentVersion,
  insertDocumentVersionAndPromote,
  insertShare,
  insertAuditLog,
  listAuditLogsForFirm,
  countAuditLogsForFirm,
  listClientMessages,
  insertClientMessage,
  listCaseDeadlines,
  listDeadlinesByCase,
  listCasesForUser,
  getCaseByIdForUser,
  insertCase,
  updateCaseStatus,
  updateCaseFields,
  findCasesByExactName,
  listCasePartiesForFirm,
  getMaxCaseNumber,
  listInvoicesByFirm,
  listInvoicesForUser,
  getInvoiceById,
  getMaxInvoiceNumber,
  insertInvoice,
  updateInvoiceFields,
  markInvoicePaidRow,
  getMonthlyBillingTotals,
  getInvoiceStats,
  listConversationsForUser,
  getConversationWithMessages,
  insertConversation,
  insertConversationMessage,
  markConversationRead,
  getActiveEncryptionKey,
  getEncryptionKeyById,
  insertEncryptionKey,
  retireActiveEncryptionKeys,
  getDashboardCounts,
  listRecentAuditActivity,
  listActivityForCase,
  insertCaseDeadline,
  createInvitedUser,
  createUserInvite,
  getUsableInviteByTokenHash,
  acceptUserInvite,
  listUsersWithInviteStatus,
  listTrustAccounts,
  getTrustAccountById,
  insertTrustAccount,
  listClientLedgersWithBalances,
  getClientLedgerById,
  getClientLedgerBalance,
  getTrustAccountClientLedgersTotal,
  getTrustAccountLedgerBalance,
  insertClientLedger,
  insertTrustTransaction,
  insertTrustTransferAndMarkInvoicePaid,
  listTrustTransactionsForLedger,
  getTrustTransactionById,
  insertTrustReconciliation,
  listTrustReconciliations,
  insertCaseIntake,
  getCaseIntake,
  updateCaseIntake,
  insertCaseIntakeEvent,
  listCaseIntakeEvents,
  activateCaseIntake,
  insertSignatureRequest,
  getSignatureRequestById,
  listSignatureRequestsByCase,
  listSignatureRequestsByFirm,
  getUsableSignatureRequestByTokenHash,
  updateSignatureRequestStatus,
  completeSignatureRequest,
  insertSignatureRequestEvent
};
