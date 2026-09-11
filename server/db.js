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

async function insertCase({ id, firmId, caseName, clientName, opposingParty, opposingCounsel, status, leadAttorneyId, caseType, clientUserId }) {
  const { rows } = await pool.query(
    `INSERT INTO cases (id, firm_id, case_name, client_name, opposing_party, opposing_counsel, status, lead_attorney_id, case_type, client_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'active'), $8, $9, $10)
     RETURNING *`,
    [id, firmId, caseName, clientName, opposingParty || null, opposingCounsel || null, status || null, leadAttorneyId || null, caseType || null, clientUserId || null]
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

// ── Invoices ─────────────────────────────────────────────────────────────
async function listInvoicesByFirm(firmId) {
  const { rows } = await pool.query(
    `SELECT invoices.*, cases.case_name FROM invoices
     LEFT JOIN cases ON cases.id = invoices.case_id
     WHERE invoices.firm_id = $1
     ORDER BY invoices.issued_date DESC`,
    [firmId]
  );
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
  let query = `SELECT conversations.*, cases.case_name,
                      (SELECT body FROM conversation_messages cm WHERE cm.conversation_id = conversations.id
                        ${user && user.role === 'CLIENT' ? "AND cm.sender != 'note'" : ''}
                       ORDER BY cm.created_at DESC LIMIT 1) AS last_message_body,
                      (SELECT sender FROM conversation_messages cm WHERE cm.conversation_id = conversations.id
                        ${user && user.role === 'CLIENT' ? "AND cm.sender != 'note'" : ''}
                       ORDER BY cm.created_at DESC LIMIT 1) AS last_message_sender,
                      (SELECT COUNT(*) FROM conversation_messages cm WHERE cm.conversation_id = conversations.id
                        AND cm.is_read = FALSE AND cm.sender != 'staff') AS unread_count
               FROM conversations
               LEFT JOIN cases ON cases.id = conversations.case_id
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

  let msgQuery = `SELECT cm.*, u.full_name AS sender_name FROM conversation_messages cm
                  LEFT JOIN users u ON u.id = cm.sender_user_id
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

async function insertConversationMessage({ conversationId, sender, senderUserId, body }) {
  const { rows } = await pool.query(
    `INSERT INTO conversation_messages (conversation_id, sender, sender_user_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [conversationId, sender, senderUserId || null, body]
  );
  await pool.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [conversationId]);
  return rows[0];
}

async function markConversationRead(conversationId) {
  await pool.query(
    `UPDATE conversation_messages SET is_read = TRUE WHERE conversation_id = $1 AND sender != 'staff'`,
    [conversationId]
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
  listCaseDeadlines,
  listCasesForUser,
  getCaseByIdForUser,
  insertCase,
  updateCaseStatus,
  getMaxCaseNumber,
  listInvoicesByFirm,
  getMonthlyBillingTotals,
  getInvoiceStats,
  listConversationsForUser,
  getConversationWithMessages,
  insertConversation,
  insertConversationMessage,
  markConversationRead,
  getDashboardCounts,
  listRecentAuditActivity,
  insertCaseDeadline
};
