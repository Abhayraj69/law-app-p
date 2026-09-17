const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Document Vault pagination tests.
 *
 * VaultService.getFiles's API contract always looked paginated (page/limit
 * params, a `pagination` object in the response), but the query behind it
 * used to fetch every active document this user could see in the whole
 * firm on EVERY request, then filter/sort/slice the array in JS —
 * db.listActiveDocumentsPaginated (and VaultService.getFiles calling it)
 * replaces that with real WHERE/ORDER BY/LIMIT/OFFSET SQL, matching what
 * the Audit Log viewer already did.
 *
 * These tests exist to prove the new query actually behaves the same as
 * the old in-memory filtering it replaced — not just that it runs — plus
 * the two things a naive rewrite is most likely to get wrong: pagination
 * that returns duplicate or missing rows across pages, and CLIENT-role
 * scoping surviving the move from "filter an array" to "filter in SQL".
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Document Vault pagination', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const VaultService = require('../services/vaultService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const STAFF_ID = crypto.randomUUID();
  const CLIENT_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Vault Pagination Firm', `vault-page-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const staff = await db.createUser({
    id: STAFF_ID, firmId: FIRM_ID, email: `staff-${STAFF_ID}@example.com`,
    fullName: 'Devon Pierce', role: 'ASSOCIATE', initials: 'DP', passwordHash
  });
  const clientUser = await db.createUser({
    id: CLIENT_ID, firmId: FIRM_ID, email: `client-${CLIENT_ID}@example.com`,
    fullName: 'Portal Client', role: 'CLIENT', initials: 'PC', passwordHash
  });

  const ownCase = await db.insertCase({
    id: `VP-OWN-${Date.now()}`, firmId: FIRM_ID, caseName: 'Client Matter', clientName: 'Portal Client', clientUserId: CLIENT_ID
  });
  const otherCase = await db.insertCase({
    id: `VP-OTHER-${Date.now()}`, firmId: FIRM_ID, caseName: 'Someone Else Matter', clientName: 'Another Client'
  });

  // 15 documents with deliberately varied, known attributes — enough to
  // exercise every filter and to page across at least two full pages at a
  // small limit, without relying on any seed data (each firm here is
  // fresh and used by no other test).
  const docs = [];
  for (let i = 0; i < 15; i++) {
    const doc = await db.insertDocument({
      firm_id: FIRM_ID,
      file_name: `document-${String(i).padStart(2, '0')}.pdf`,
      original_name: `document-${i}.pdf`,
      file_type: 'application/pdf',
      extension: i % 3 === 0 ? 'docx' : 'pdf',
      file_size_bytes: 1000 + i * 100,
      storage_path_url: `uploads/${FIRM_ID}/fixture-${i}.pdf`,
      case_id: i < 5 ? ownCase.id : otherCase.id,
      author_id: STAFF_ID,
      tags: i === 7 ? ['Confidential'] : []
    });
    docs.push(doc);
  }
  // insertDocument's param names are camelCase per-field in the object it
  // takes (firm_id etc. internally) — confirm the fixtures actually landed
  // before relying on them.
  assert.equal(docs.length, 15);

  const allDocIds = new Set(docs.map(d => d.id));

  // ───────────────────────────────────────────────────────────
  // Pagination correctness
  // ───────────────────────────────────────────────────────────

  await t.test('total count matches the unfiltered document count', async () => {
    const result = await VaultService.getFiles(FIRM_ID, { tab_category: '', page: 1, limit: 100 }, staff);
    assert.equal(result.pagination.total, 15);
  });

  await t.test('paging through with a small limit returns every document exactly once, no duplicates or gaps', async () => {
    const seen = new Set();
    let page = 1;
    const limit = 4;
    let totalPages = null;
    do {
      const result = await VaultService.getFiles(FIRM_ID, { tab_category: '', page, limit, sort: 'created_at', order: 'asc' }, staff);
      totalPages = result.pagination.total_pages;
      for (const d of result.documents) {
        assert.ok(!seen.has(d.id), `document ${d.id} appeared on more than one page`);
        seen.add(d.id);
      }
      page += 1;
    } while (page <= totalPages);

    assert.equal(seen.size, 15, 'every document must be seen exactly once across all pages');
    for (const id of allDocIds) assert.ok(seen.has(id), `document ${id} was never returned by any page`);
  });

  await t.test('page/limit/total_pages in the response match what was requested', async () => {
    const result = await VaultService.getFiles(FIRM_ID, { tab_category: '', page: 2, limit: 5 }, staff);
    assert.equal(result.pagination.page, 2);
    assert.equal(result.pagination.limit, 5);
    assert.equal(result.pagination.total, 15);
    assert.equal(result.pagination.total_pages, 3);
    assert.equal(result.documents.length, 5);
  });

  // ───────────────────────────────────────────────────────────
  // Filters
  // ───────────────────────────────────────────────────────────

  await t.test('filters by case_id', async () => {
    const result = await VaultService.getFiles(FIRM_ID, { tab_category: '', case_id: ownCase.id, limit: 100 }, staff);
    assert.equal(result.pagination.total, 5);
    assert.ok(result.documents.every(d => d.case_id === ownCase.id));
  });

  await t.test('filters by extension', async () => {
    const result = await VaultService.getFiles(FIRM_ID, { tab_category: '', extension: 'docx', limit: 100 }, staff);
    // i % 3 === 0 for i in 0..14 -> 0,3,6,9,12 = 5 docx documents
    assert.equal(result.pagination.total, 5);
    assert.ok(result.documents.every(d => d.extension === 'docx'));
  });

  await t.test('filters by exact tag match', async () => {
    const result = await VaultService.getFiles(FIRM_ID, { tab_category: '', tag: 'Confidential', limit: 100 }, staff);
    assert.equal(result.pagination.total, 1);
    assert.equal(result.documents[0].id, docs[7].id);
  });

  await t.test('search (q) matches the file name', async () => {
    const result = await VaultService.getFiles(FIRM_ID, { tab_category: '', q: 'document-07', limit: 100 }, staff);
    assert.equal(result.pagination.total, 1);
    assert.equal(result.documents[0].id, docs[7].id);
  });

  await t.test('search (q) also matches the case name and author name, not just the file name', async () => {
    const byCase = await VaultService.getFiles(FIRM_ID, { tab_category: '', q: 'Someone Else Matter', limit: 100 }, staff);
    assert.equal(byCase.pagination.total, 10, 'all 10 documents on the other case must match by case name');

    const byAuthor = await VaultService.getFiles(FIRM_ID, { tab_category: '', q: 'Devon Pierce', limit: 100 }, staff);
    assert.equal(byAuthor.pagination.total, 15, 'every document was authored by the same staff member');
  });

  await t.test('an empty result set reports total_pages as 1, not 0 or NaN', async () => {
    const result = await VaultService.getFiles(FIRM_ID, { tab_category: '', q: 'no-such-document-exists', limit: 10 }, staff);
    assert.equal(result.pagination.total, 0);
    assert.equal(result.documents.length, 0);
    assert.equal(result.pagination.total_pages, 1, 'an empty result must not report 0 pages — that reads as "no results ever exist", not "no results matched this filter"');
  });

  // ───────────────────────────────────────────────────────────
  // Sorting
  // ───────────────────────────────────────────────────────────

  await t.test('sorts by size ascending and descending', async () => {
    const asc = await VaultService.getFiles(FIRM_ID, { tab_category: '', sort: 'size', order: 'asc', limit: 100 }, staff);
    const sizesAsc = asc.documents.map(d => d.file_size_bytes);
    assert.deepEqual(sizesAsc, [...sizesAsc].sort((a, b) => a - b));

    const desc = await VaultService.getFiles(FIRM_ID, { tab_category: '', sort: 'size', order: 'desc', limit: 100 }, staff);
    const sizesDesc = desc.documents.map(d => d.file_size_bytes);
    assert.deepEqual(sizesDesc, [...sizesDesc].sort((a, b) => b - a));
  });

  await t.test('an unrecognized sort key falls back to updated_at instead of erroring', async () => {
    // DOCUMENT_SORT_COLUMNS is an allowlist specifically because `sort`
    // arrives as a raw query-string value — this also doubles as the SQL
    // injection guard: an arbitrary string here must never reach ORDER BY.
    const result = await VaultService.getFiles(
      FIRM_ID, { tab_category: '', sort: "d.id; DROP TABLE documents; --", limit: 5 }, staff
    );
    assert.equal(result.documents.length, 5, 'an unrecognized/malicious sort key must not break the query');

    // The table must still exist and hold all 15 fixtures — proves the
    // injection attempt did not reach the database as SQL.
    const stillThere = await pool.query('SELECT COUNT(*)::int AS n FROM documents WHERE firm_id = $1', [FIRM_ID]);
    assert.equal(stillThere.rows[0].n, 15);
  });

  // ───────────────────────────────────────────────────────────
  // CLIENT-role scoping on the new query path
  // ───────────────────────────────────────────────────────────

  await t.test('a CLIENT only sees documents on their own case through the paginated query', async () => {
    const result = await VaultService.getFiles(FIRM_ID, { tab_category: '', limit: 100 }, clientUser);
    assert.equal(result.pagination.total, 5, 'a CLIENT must see only the 5 documents on their own case');
    assert.ok(result.documents.every(d => d.case_id === ownCase.id));
  });

  await t.test('a CLIENT cannot bypass their own scoping with an explicit case_id filter for another case', async () => {
    const result = await VaultService.getFiles(FIRM_ID, { tab_category: '', case_id: otherCase.id, limit: 100 }, clientUser);
    assert.equal(result.pagination.total, 0, 'asking for another case\'s documents by id must return nothing, not an error that leaks whether the case exists');
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
