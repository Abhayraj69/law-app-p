const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Time tracking + invoice line item tests.
 *
 * Covers what TimeEntryService's own header comment claims:
 *
 *   - a PARALEGAL sees and can edit/delete only their OWN entries;
 *     ASSOCIATE+ sees the whole firm's and may correct anyone's unbilled
 *     entry, but may still only ever CREATE an entry under their own id;
 *   - an invoiced entry becomes immutable — no edit, no delete;
 *   - generateInvoiceFromTimeEntries is all-or-nothing: any entry that
 *     doesn't belong to the named case, isn't billable, or isn't
 *     'unbilled' refuses the WHOLE request, not a partial invoice;
 *   - the generated invoice's amount_cents equals the sum of its line
 *     items, and each line item's amount matches its own
 *     quantity/rate — the arithmetic this feature exists to get right;
 *   - the transaction is atomic: db.insertInvoiceFromTimeEntries re-checks
 *     status = 'unbilled' at UPDATE time and rolls back on a concurrent
 *     double-invoice race, driven directly to prove it rather than assumed.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Time tracking and invoice line items', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const TimeEntryService = require('../services/timeEntryService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const OTHER_FIRM_ID = crypto.randomUUID();
  const PARALEGAL_ID = crypto.randomUUID();
  const OTHER_PARALEGAL_ID = crypto.randomUUID();
  const ASSOCIATE_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Time Tracking Firm', `time-${FIRM_ID}.example`
  ]);
  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    OTHER_FIRM_ID, 'Other Time Tracking Firm', `time-other-${OTHER_FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);
  await db.ensureStorageQuota(OTHER_FIRM_ID);

  const paralegal = await db.createUser({
    id: PARALEGAL_ID, firmId: FIRM_ID, email: `paralegal-${PARALEGAL_ID}@example.com`,
    fullName: 'Test Paralegal', role: 'PARALEGAL', initials: 'TP', passwordHash
  });
  await pool.query('UPDATE users SET default_rate_cents = $1 WHERE id = $2', [15000, PARALEGAL_ID]);

  const otherParalegal = await db.createUser({
    id: OTHER_PARALEGAL_ID, firmId: FIRM_ID, email: `other-paralegal-${OTHER_PARALEGAL_ID}@example.com`,
    fullName: 'Other Paralegal', role: 'PARALEGAL', initials: 'OP', passwordHash
  });
  await pool.query('UPDATE users SET default_rate_cents = $1 WHERE id = $2', [15000, OTHER_PARALEGAL_ID]);

  const associate = await db.createUser({
    id: ASSOCIATE_ID, firmId: FIRM_ID, email: `associate-${ASSOCIATE_ID}@example.com`,
    fullName: 'Test Associate', role: 'ASSOCIATE', initials: 'TA', passwordHash
  });
  await pool.query('UPDATE users SET default_rate_cents = $1 WHERE id = $2', [30000, ASSOCIATE_ID]);

  // Re-read so in-memory user objects reflect default_rate_cents (createUser
  // doesn't return it — it wasn't a createUser column before this feature).
  const paralegalFresh = await db.getUserByIdAndFirm(PARALEGAL_ID, FIRM_ID);
  const otherParalegalFresh = await db.getUserByIdAndFirm(OTHER_PARALEGAL_ID, FIRM_ID);
  const associateFresh = await db.getUserByIdAndFirm(ASSOCIATE_ID, FIRM_ID);

  const caseA = await db.insertCase({ id: `TT-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Case A', clientName: 'Client A' });
  const caseB = await db.insertCase({ id: `TT-B-${Date.now()}`, firmId: FIRM_ID, caseName: 'Case B', clientName: 'Client B' });

  // ───────────────────────────────────────────────────────────
  // Creation and validation
  // ───────────────────────────────────────────────────────────

  await t.test('a time entry defaults to the acting user\'s own rate when none is given', async () => {
    const entry = await TimeEntryService.createTimeEntry(FIRM_ID, paralegalFresh, {
      case_id: caseA.id, minutes: 90, description: 'Document review'
    });
    assert.equal(entry.rate_cents, 15000);
    assert.equal(entry.user_id, PARALEGAL_ID, 'an entry is always logged under the ACTING user, not a caller-supplied one');
    assert.equal(entry.amount_cents, Math.round((90 / 60) * 15000));
  });

  await t.test('a user with no default rate must supply one explicitly', async () => {
    const noRateUser = { ...paralegalFresh, id: crypto.randomUUID(), default_rate_cents: null };
    const withNoRate = await db.createUser({
      id: noRateUser.id, firmId: FIRM_ID, email: `norate-${noRateUser.id}@example.com`,
      fullName: 'No Rate User', role: 'PARALEGAL', initials: 'NR', passwordHash
    });
    await assert.rejects(
      () => TimeEntryService.createTimeEntry(FIRM_ID, withNoRate, { case_id: caseA.id, minutes: 30, description: 'work' }),
      (err) => err.status === 400 && err.code === 'NO_DEFAULT_RATE'
    );
  });

  await t.test('minutes must be a positive integer within a sane ceiling', async () => {
    for (const bad of [0, -30, 1.5, 1441, '60']) {
      await assert.rejects(
        () => TimeEntryService.createTimeEntry(FIRM_ID, paralegalFresh, { case_id: caseA.id, minutes: bad, description: 'x' }),
        (err) => err.status === 400,
        `minutes of ${JSON.stringify(bad)} must be refused`
      );
    }
  });

  await t.test('a description is required', async () => {
    await assert.rejects(
      () => TimeEntryService.createTimeEntry(FIRM_ID, paralegalFresh, { case_id: caseA.id, minutes: 30, description: '   ' }),
      (err) => err.status === 400
    );
  });

  await t.test('case_id must name a real case in this firm', async () => {
    await assert.rejects(
      () => TimeEntryService.createTimeEntry(FIRM_ID, paralegalFresh, { case_id: 'NO-SUCH-CASE', minutes: 30, description: 'x' }),
      (err) => err.status === 400 && err.code === 'CASE_NOT_FOUND'
    );
  });

  // ───────────────────────────────────────────────────────────
  // Ownership scoping — PARALEGAL vs ASSOCIATE+
  // ───────────────────────────────────────────────────────────

  await t.test('a PARALEGAL sees only their own entries', async () => {
    await TimeEntryService.createTimeEntry(FIRM_ID, otherParalegalFresh, {
      case_id: caseA.id, minutes: 60, description: 'Other paralegal\'s work'
    });

    const own = await TimeEntryService.listTimeEntries(FIRM_ID, paralegalFresh, {});
    assert.ok(own.every(e => e.user_id === PARALEGAL_ID), 'a PARALEGAL must never see another user\'s entries');
    assert.ok(own.length > 0);
  });

  await t.test('a PARALEGAL cannot see another user\'s entries by passing a user_id filter', async () => {
    // The scoping rule is unconditional, not a default that a filter can
    // override — this is the exact bypass attempt the rule exists to stop.
    const attempted = await TimeEntryService.listTimeEntries(FIRM_ID, paralegalFresh, { user_id: OTHER_PARALEGAL_ID });
    assert.ok(attempted.every(e => e.user_id === PARALEGAL_ID), 'a user_id filter must not let a PARALEGAL read someone else\'s entries');
  });

  await t.test('ASSOCIATE+ sees every entry in the firm', async () => {
    const all = await TimeEntryService.listTimeEntries(FIRM_ID, associateFresh, {});
    const userIds = new Set(all.map(e => e.user_id));
    assert.ok(userIds.has(PARALEGAL_ID) && userIds.has(OTHER_PARALEGAL_ID), 'ASSOCIATE+ must see entries from multiple users');
  });

  await t.test('a PARALEGAL cannot edit another user\'s entry', async () => {
    const others = await TimeEntryService.listTimeEntries(FIRM_ID, associateFresh, { user_id: OTHER_PARALEGAL_ID });
    const target = others[0];
    await assert.rejects(
      () => TimeEntryService.updateTimeEntry(FIRM_ID, paralegalFresh, target.id, { minutes: 999 }),
      (err) => err.status === 403
    );
  });

  await t.test('ASSOCIATE+ CAN correct another user\'s unbilled entry', async () => {
    const others = await TimeEntryService.listTimeEntries(FIRM_ID, associateFresh, { user_id: OTHER_PARALEGAL_ID });
    const target = others[0];
    const updated = await TimeEntryService.updateTimeEntry(FIRM_ID, associateFresh, target.id, { minutes: 45 });
    assert.equal(updated.minutes, 45, 'a supervisory correction to an unbilled entry must succeed');
  });

  await t.test('a PARALEGAL cannot delete another user\'s entry', async () => {
    const others = await TimeEntryService.listTimeEntries(FIRM_ID, associateFresh, { user_id: OTHER_PARALEGAL_ID });
    const target = others[0];
    await assert.rejects(
      () => TimeEntryService.deleteTimeEntry(FIRM_ID, paralegalFresh, target.id),
      (err) => err.status === 403
    );
  });

  // ───────────────────────────────────────────────────────────
  // Firm isolation
  // ───────────────────────────────────────────────────────────

  await t.test('a time entry cannot be created against a case in another firm', async () => {
    const otherCase = await db.insertCase({ id: `TT-OTHER-${Date.now()}`, firmId: OTHER_FIRM_ID, caseName: 'Other Firm Case', clientName: 'X' });
    await assert.rejects(
      () => TimeEntryService.createTimeEntry(FIRM_ID, paralegalFresh, { case_id: otherCase.id, minutes: 30, description: 'x' }),
      (err) => err.code === 'CASE_NOT_FOUND'
    );
  });

  await t.test('an entry id from another firm is invisible, not just unauthorized', async () => {
    const probe = await TimeEntryService.createTimeEntry(FIRM_ID, paralegalFresh, { case_id: caseA.id, minutes: 15, description: 'firm-scoped probe' });
    await assert.rejects(
      () => TimeEntryService.updateTimeEntry(OTHER_FIRM_ID, associateFresh, probe.id, { minutes: 20 }),
      (err) => err.status === 404
    );
  });

  // ───────────────────────────────────────────────────────────
  // Immutability once invoiced
  // ───────────────────────────────────────────────────────────

  async function makeUnbilledEntry(user, caseRow, minutes = 60, description = 'Billable work') {
    return TimeEntryService.createTimeEntry(FIRM_ID, user, { case_id: caseRow.id, minutes, description });
  }

  await t.test('generating an invoice requires every entry to belong to the SAME named case', async () => {
    const entryA = await makeUnbilledEntry(paralegalFresh, caseA);
    const entryB = await makeUnbilledEntry(paralegalFresh, caseB);

    await assert.rejects(
      () => TimeEntryService.generateInvoiceFromTimeEntries(FIRM_ID, associateFresh, {
        case_id: caseA.id, time_entry_ids: [entryA.id, entryB.id]
      }),
      (err) => err.code === 'CASE_MISMATCH'
    );

    // Neither entry may have been marked invoiced by the refused attempt.
    const stillA = await db.getTimeEntryById(FIRM_ID, entryA.id);
    const stillB = await db.getTimeEntryById(FIRM_ID, entryB.id);
    assert.equal(stillA.status, 'unbilled');
    assert.equal(stillB.status, 'unbilled');
  });

  await t.test('a non-billable entry cannot be invoiced', async () => {
    const entry = await makeUnbilledEntry(paralegalFresh, caseA);
    await TimeEntryService.updateTimeEntry(FIRM_ID, paralegalFresh, entry.id, { billable: false });

    await assert.rejects(
      () => TimeEntryService.generateInvoiceFromTimeEntries(FIRM_ID, associateFresh, {
        case_id: caseA.id, time_entry_ids: [entry.id]
      }),
      (err) => err.code === 'NOT_BILLABLE'
    );
  });

  await t.test('generating an invoice produces line items whose amounts and total are exactly right', async () => {
    // Both under caseB, both billable, known minutes/rates so the expected
    // arithmetic can be asserted exactly rather than just "some number".
    const e1 = await TimeEntryService.createTimeEntry(FIRM_ID, associateFresh, {
      case_id: caseB.id, minutes: 90, rate_cents: 40000, description: 'Drafting'
    }); // 90/60 * 40000 = 60000
    const e2 = await TimeEntryService.createTimeEntry(FIRM_ID, associateFresh, {
      case_id: caseB.id, minutes: 45, rate_cents: 30000, description: 'Research'
    }); // 45/60 * 30000 = 22500

    const invoice = await TimeEntryService.generateInvoiceFromTimeEntries(FIRM_ID, associateFresh, {
      case_id: caseB.id, time_entry_ids: [e1.id, e2.id]
    });

    assert.equal(invoice.amount_cents, 82500, 'invoice.amount_cents must equal the sum of its line items');
    assert.equal(invoice.status, 'draft');
    assert.equal(invoice.case_id, caseB.id);

    const lineItems = await TimeEntryService.getLineItems(FIRM_ID, invoice.id);
    assert.equal(lineItems.length, 2);
    const total = lineItems.reduce((sum, li) => sum + li.amount_cents, 0);
    assert.equal(total, invoice.amount_cents, 'the sum of stored line item amounts must equal the invoice total');

    const byDescription = Object.fromEntries(lineItems.map(li => [li.description, li]));
    assert.equal(byDescription['Drafting'].amount_cents, 60000);
    assert.equal(byDescription['Drafting'].quantity_minutes, 90);
    assert.equal(byDescription['Research'].amount_cents, 22500);

    // Both time entries must now be marked invoiced and point at their
    // respective line item.
    const after1 = await db.getTimeEntryById(FIRM_ID, e1.id);
    const after2 = await db.getTimeEntryById(FIRM_ID, e2.id);
    assert.equal(after1.status, 'invoiced');
    assert.equal(after2.status, 'invoiced');
    assert.ok(after1.invoice_line_item_id);
    assert.ok(after2.invoice_line_item_id);
  });

  await t.test('an already-invoiced entry cannot be edited', async () => {
    const invoiced = (await TimeEntryService.listTimeEntries(FIRM_ID, associateFresh, { case_id: caseB.id, status: 'invoiced' }))[0];
    await assert.rejects(
      () => TimeEntryService.updateTimeEntry(FIRM_ID, associateFresh, invoiced.id, { minutes: 999 }),
      (err) => err.status === 400 && err.code === 'ALREADY_INVOICED'
    );
  });

  await t.test('an already-invoiced entry cannot be deleted', async () => {
    const invoiced = (await TimeEntryService.listTimeEntries(FIRM_ID, associateFresh, { case_id: caseB.id, status: 'invoiced' }))[0];
    await assert.rejects(
      () => TimeEntryService.deleteTimeEntry(FIRM_ID, associateFresh, invoiced.id),
      (err) => err.code === 'ALREADY_INVOICED'
    );
  });

  await t.test('an already-invoiced entry cannot be invoiced a second time', async () => {
    const invoiced = (await TimeEntryService.listTimeEntries(FIRM_ID, associateFresh, { case_id: caseB.id, status: 'invoiced' }))[0];
    await assert.rejects(
      () => TimeEntryService.generateInvoiceFromTimeEntries(FIRM_ID, associateFresh, {
        case_id: caseB.id, time_entry_ids: [invoiced.id]
      }),
      (err) => err.code === 'ALREADY_INVOICED'
    );
  });

  // ───────────────────────────────────────────────────────────
  // Atomicity of the underlying db transaction
  // ───────────────────────────────────────────────────────────

  await t.test('db.insertInvoiceFromTimeEntries rolls back if a concurrent race has already invoiced one of the entries', async () => {
    // Drives the db layer directly: create two unbilled entries, then mark
    // ONE of them invoiced out from under the call (simulating the exact
    // race two simultaneous "Generate Invoice" clicks would produce),
    // and confirm the whole transaction reports failure rather than
    // silently billing only the other entry.
    const e1 = await TimeEntryService.createTimeEntry(FIRM_ID, associateFresh, { case_id: caseA.id, minutes: 30, description: 'Race entry 1' });
    const e2 = await TimeEntryService.createTimeEntry(FIRM_ID, associateFresh, { case_id: caseA.id, minutes: 30, description: 'Race entry 2' });

    // Simulate a second, already-completed generation for e2 by hand.
    await pool.query(`UPDATE time_entries SET status = 'invoiced' WHERE id = $1`, [e2.id]);

    const beforeCount = (await pool.query('SELECT COUNT(*)::int AS n FROM invoices WHERE firm_id = $1', [FIRM_ID])).rows[0].n;

    const result = await db.insertInvoiceFromTimeEntries({
      firmId: FIRM_ID, caseId: caseA.id, invoiceNumber: `INV-RACE-${Date.now()}`,
      entries: [e1, e2], issuedDate: null, dueDate: null
    });

    assert.equal(result, null, 'a race against an already-invoiced entry must report failure');

    const afterCount = (await pool.query('SELECT COUNT(*)::int AS n FROM invoices WHERE firm_id = $1', [FIRM_ID])).rows[0].n;
    assert.equal(afterCount, beforeCount, 'no orphaned invoice may survive the rollback');

    const e1After = await db.getTimeEntryById(FIRM_ID, e1.id);
    assert.equal(e1After.status, 'unbilled', 'the entry that was NOT part of the race must be rolled back too, not left half-invoiced');
    assert.equal(e1After.invoice_line_item_id, null);
  });

  await t.test('time_entry_ids must be a non-empty array', async () => {
    await assert.rejects(
      () => TimeEntryService.generateInvoiceFromTimeEntries(FIRM_ID, associateFresh, { case_id: caseA.id, time_entry_ids: [] }),
      (err) => err.status === 400
    );
    await assert.rejects(
      () => TimeEntryService.generateInvoiceFromTimeEntries(FIRM_ID, associateFresh, { case_id: caseA.id }),
      (err) => err.status === 400
    );
  });

  await t.test('an unknown time entry id is refused by name', async () => {
    const fakeId = crypto.randomUUID();
    await assert.rejects(
      () => TimeEntryService.generateInvoiceFromTimeEntries(FIRM_ID, associateFresh, { case_id: caseA.id, time_entry_ids: [fakeId] }),
      (err) => err.code === 'ENTRY_NOT_FOUND' && err.message.includes(fakeId)
    );
  });

  // ───────────────────────────────────────────────────────────
  // Audit trail
  // ───────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────
  // Invoice/line-item consistency
  // ───────────────────────────────────────────────────────────

  await t.test('an invoice generated from time entries cannot have its amount edited directly', async () => {
    const InvoiceService = require('../services/invoiceService');
    const entry = await TimeEntryService.createTimeEntry(FIRM_ID, associateFresh, {
      case_id: caseA.id, minutes: 60, rate_cents: 20000, description: 'Consistency check work'
    });
    const invoice = await TimeEntryService.generateInvoiceFromTimeEntries(FIRM_ID, associateFresh, {
      case_id: caseA.id, time_entry_ids: [entry.id]
    });

    await assert.rejects(
      () => InvoiceService.updateInvoice(FIRM_ID, associateFresh, invoice.id, { amount_cents: 999999 }),
      (err) => err.status === 400 && err.code === 'AMOUNT_DERIVED_FROM_LINE_ITEMS'
    );

    const unchanged = await db.getInvoiceById(FIRM_ID, invoice.id);
    assert.equal(unchanged.amount_cents, invoice.amount_cents, 'a refused edit must not have changed the amount');
  });

  await t.test('a flat invoice with no line items can still have its amount edited normally', async () => {
    const InvoiceService = require('../services/invoiceService');
    const flat = await InvoiceService.createInvoice(FIRM_ID, associateFresh, { amount_cents: 50000 });
    const updated = await InvoiceService.updateInvoice(FIRM_ID, associateFresh, flat.id, { amount_cents: 75000 });
    assert.equal(updated.amount_cents, 75000, 'a normal, non-line-item invoice must remain editable');
  });

  await t.test('time tracking actions are all written to the audit log', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT action::text AS action FROM audit_logs WHERE firm_id = $1 AND action::text LIKE '%TIME%'`,
      [FIRM_ID]
    );
    const actions = new Set(rows.map(r => r.action));
    assert.ok(actions.has('CREATE_TIME_ENTRY'));
    assert.ok(actions.has('UPDATE_TIME_ENTRY'));
    assert.ok(actions.has('GENERATE_INVOICE_FROM_TIME'));
  });

  await pool.query('DELETE FROM firms WHERE id = ANY($1)', [[FIRM_ID, OTHER_FIRM_ID]]);
});
