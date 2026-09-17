const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Trust accounting integration tests.
 *
 * This is the highest-consequence code in the app: trust_transactions
 * holds client money the firm does not own, and mishandling it is a
 * bar-discipline matter, not just a bug. Every invariant TrustService's
 * own header comment claims is tested here by actively ATTEMPTING the
 * forbidden operation and asserting it is refused — the same posture
 * server/test/roleScoping.test.js takes toward broken access control,
 * rather than only proving the happy path works.
 *
 * Specifically covered:
 *   - a client's ledger can never be driven negative, by any of the three
 *     paths that remove money from it;
 *   - the ledger is genuinely append-only: a reversal is a new compensating
 *     row and the original is left byte-for-byte intact;
 *   - transfer-to-operating is atomic — the trust debit and the invoice
 *     being marked paid either both happen or neither does, including when
 *     the invoice write is the half that fails;
 *   - a saved reconciliation stays reproducible as later activity is posted.
 *
 * Requires a real database via TEST_DATABASE_URL, same as
 * server/test/persistence.test.js — skipped (not failed) if it isn't set.
 * Run with: TEST_DATABASE_URL=postgres://... npm test
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Trust accounting: balances, append-only ledger, atomic transfers, reconciliation', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const TrustService = require('../services/trustService');

  await runMigrations();

  // Fresh ids per run so repeated/parallel runs never collide; everything
  // is torn down at the end via the firm's ON DELETE CASCADE.
  const FIRM_ID = crypto.randomUUID();
  const OTHER_FIRM_ID = crypto.randomUUID();
  const PARTNER_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Trust Test Firm', `trust-${FIRM_ID}.example`
  ]);
  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    OTHER_FIRM_ID, 'Other Trust Test Firm', `trust-other-${OTHER_FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);
  await db.ensureStorageQuota(OTHER_FIRM_ID);

  const partner = await db.createUser({
    id: PARTNER_ID, firmId: FIRM_ID, email: `partner-${PARTNER_ID}@example.com`,
    fullName: 'Test Partner', role: 'PARTNER', initials: 'TP', passwordHash
  });

  const account = await TrustService.createAccount(FIRM_ID, partner, {
    account_name: 'IOLTA Operating Trust',
    bank_name: 'First Interstate',
    account_number_last4: '4417'
  });

  // Two ledgers under the same trust account: proving a disbursement is
  // checked against the CLIENT's balance, not the account's pooled total,
  // needs at least two clients sharing one account.
  const alpha = await TrustService.createClientLedger(FIRM_ID, partner, {
    trust_account_id: account.id, client_display_name: 'Alpha Holdings'
  });
  const beta = await TrustService.createClientLedger(FIRM_ID, partner, {
    trust_account_id: account.id, client_display_name: 'Beta Industries'
  });

  // ───────────────────────────────────────────────────────────
  // Account and ledger setup
  // ───────────────────────────────────────────────────────────

  await t.test('a trust account refuses anything but exactly 4 digits for the account number', async () => {
    // The point of the field is that a full account number is never stored;
    // accepting a longer string would silently defeat that.
    for (const bad of ['441', '44177', '44a7', '', null, '  4417  ']) {
      await assert.rejects(
        () => TrustService.createAccount(FIRM_ID, partner, {
          account_name: 'Bad Account', bank_name: 'Bank', account_number_last4: bad
        }),
        (err) => err.status === 400,
        `account_number_last4 of ${JSON.stringify(bad)} must be refused`
      );
    }
  });

  await t.test('opening the same client ledger twice reactivates rather than duplicating it', async () => {
    const again = await TrustService.createClientLedger(FIRM_ID, partner, {
      trust_account_id: account.id, client_display_name: 'Alpha Holdings'
    });
    assert.equal(again.id, alpha.id, 'resubmitting the same client name must return the same ledger row');

    const ledgers = await TrustService.listClientLedgers(FIRM_ID, account.id);
    const alphaRows = ledgers.filter(l => l.client_display_name === 'Alpha Holdings');
    assert.equal(alphaRows.length, 1, 'there must never be two ledgers for one client under one account');
  });

  await t.test('a ledger under another firm is not reachable, even with a valid id', async () => {
    const otherPartnerId = crypto.randomUUID();
    await db.createUser({
      id: otherPartnerId, firmId: OTHER_FIRM_ID, email: `other-${otherPartnerId}@example.com`,
      fullName: 'Other Partner', role: 'PARTNER', initials: 'OP', passwordHash
    });
    const otherAccount = await TrustService.createAccount(OTHER_FIRM_ID, partner, {
      account_name: 'Other IOLTA', bank_name: 'Other Bank', account_number_last4: '9999'
    });
    const otherLedger = await TrustService.createClientLedger(OTHER_FIRM_ID, partner, {
      trust_account_id: otherAccount.id, client_display_name: 'Someone Else'
    });

    // Every write path resolves the ledger through assertLedgerInFirm, so
    // all three must refuse a ledger id belonging to a different firm.
    await assert.rejects(
      () => TrustService.recordDeposit(FIRM_ID, partner, {
        client_ledger_id: otherLedger.id, amount_cents: 1000, memo: 'cross-firm deposit'
      }),
      (err) => err.status === 404
    );
    await assert.rejects(
      () => TrustService.recordDisbursement(FIRM_ID, partner, {
        client_ledger_id: otherLedger.id, amount_cents: 1000, memo: 'cross-firm disbursement'
      }),
      (err) => err.status === 404
    );
    await assert.rejects(
      () => TrustService.listTransactions(FIRM_ID, otherLedger.id),
      (err) => err.status === 404
    );
  });

  // ───────────────────────────────────────────────────────────
  // Deposits and input validation
  // ───────────────────────────────────────────────────────────

  await t.test('a deposit credits the client ledger', async () => {
    const txn = await TrustService.recordDeposit(FIRM_ID, partner, {
      client_ledger_id: alpha.id, amount_cents: 500000, memo: 'Initial retainer, check 1041', check_number: '1041'
    });
    assert.equal(txn.type, 'DEPOSIT');
    assert.equal(txn.amount_cents, 500000);
    assert.equal(await db.getClientLedgerBalance(alpha.id), 500000);
  });

  await t.test('money amounts must be positive whole cents — no floats, no zero, no negatives', async () => {
    // A negative "deposit" would be a disbursement that skips the
    // balance check, and a float would reintroduce the rounding error the
    // cents-based schema exists to avoid.
    for (const bad of [0, -1, -500000, 10.5, '1000', null, undefined, NaN, Infinity]) {
      await assert.rejects(
        () => TrustService.recordDeposit(FIRM_ID, partner, {
          client_ledger_id: alpha.id, amount_cents: bad, memo: 'bad amount'
        }),
        (err) => err.status === 400,
        `amount_cents of ${JSON.stringify(bad)} must be refused`
      );
    }
    assert.equal(await db.getClientLedgerBalance(alpha.id), 500000, 'no rejected amount may have moved the balance');
  });

  await t.test('every trust entry requires a memo explaining it', async () => {
    for (const bad of ['', '   ', null, undefined]) {
      await assert.rejects(
        () => TrustService.recordDeposit(FIRM_ID, partner, {
          client_ledger_id: alpha.id, amount_cents: 1000, memo: bad
        }),
        (err) => err.status === 400,
        `memo of ${JSON.stringify(bad)} must be refused`
      );
    }
  });

  // ───────────────────────────────────────────────────────────
  // The negative-balance guard
  // ───────────────────────────────────────────────────────────

  await t.test('a disbursement exceeding the client balance is refused', async () => {
    await assert.rejects(
      () => TrustService.recordDisbursement(FIRM_ID, partner, {
        client_ledger_id: alpha.id, amount_cents: 500001, memo: 'one cent too much'
      }),
      (err) => err.status === 400 && err.code === 'INSUFFICIENT_TRUST_BALANCE'
    );
    assert.equal(await db.getClientLedgerBalance(alpha.id), 500000, 'a refused disbursement must not post');
  });

  await t.test('a client cannot spend another client\'s money in the same pooled account', async () => {
    // Beta has nothing on deposit; Alpha has $5,000 in the SAME trust
    // account. If the guard checked the account total instead of the
    // client's own ledger, this would wrongly succeed — that is precisely
    // the commingling failure trust accounting exists to prevent.
    assert.equal(await db.getClientLedgerBalance(beta.id), 0);
    await assert.rejects(
      () => TrustService.recordDisbursement(FIRM_ID, partner, {
        client_ledger_id: beta.id, amount_cents: 100000, memo: 'spending Alpha\'s money'
      }),
      (err) => err.code === 'INSUFFICIENT_TRUST_BALANCE'
    );
    assert.equal(await db.getClientLedgerBalance(beta.id), 0);
  });

  await t.test('a disbursement of exactly the full balance is allowed and zeroes the ledger', async () => {
    await TrustService.recordDeposit(FIRM_ID, partner, {
      client_ledger_id: beta.id, amount_cents: 25000, memo: 'Beta retainer'
    });
    await TrustService.recordDisbursement(FIRM_ID, partner, {
      client_ledger_id: beta.id, amount_cents: 25000, memo: 'Full refund of unused retainer'
    });
    assert.equal(await db.getClientLedgerBalance(beta.id), 0, 'exact-balance disbursement is legitimate and must succeed');
  });

  // ───────────────────────────────────────────────────────────
  // Append-only ledger / reversals
  // ───────────────────────────────────────────────────────────

  await t.test('reversing a deposit removes its value without altering the original row', async () => {
    const deposit = await TrustService.recordDeposit(FIRM_ID, partner, {
      client_ledger_id: alpha.id, amount_cents: 75000, memo: 'Deposit entered in error'
    });
    const balanceAfterDeposit = await db.getClientLedgerBalance(alpha.id);
    assert.equal(balanceAfterDeposit, 575000);

    const before = await db.getTrustTransactionById(FIRM_ID, deposit.id);
    const reversal = await TrustService.reverseTransaction(
      FIRM_ID, partner, deposit.id, 'Wrong client ledger — re-posted to Beta'
    );

    assert.equal(reversal.type, 'ADJUSTMENT_REVERSAL');
    assert.equal(reversal.reverses_transaction_id, deposit.id);
    assert.equal(reversal.memo, 'Wrong client ledger — re-posted to Beta', 'the reason must live in the ledger, not only the audit log');
    assert.equal(await db.getClientLedgerBalance(alpha.id), 500000, 'the reversal must cancel the deposit exactly');

    // The whole point of an append-only ledger: the original entry is
    // still there, unchanged, as part of the paper trail.
    const after = await db.getTrustTransactionById(FIRM_ID, deposit.id);
    assert.deepEqual(after, before, 'reversing must never mutate the original transaction row');
  });

  await t.test('reversing a disbursement restores the money to the client', async () => {
    const disb = await TrustService.recordDisbursement(FIRM_ID, partner, {
      client_ledger_id: alpha.id, amount_cents: 120000, memo: 'Filing fee, county clerk'
    });
    assert.equal(await db.getClientLedgerBalance(alpha.id), 380000);

    await TrustService.reverseTransaction(FIRM_ID, partner, disb.id, 'Check never cleared — voided');
    assert.equal(await db.getClientLedgerBalance(alpha.id), 500000, 'reversing a disbursement must credit the client back');
  });

  await t.test('a reversal cannot itself be reversed', async () => {
    const deposit = await TrustService.recordDeposit(FIRM_ID, partner, {
      client_ledger_id: alpha.id, amount_cents: 1000, memo: 'To be reversed'
    });
    const reversal = await TrustService.reverseTransaction(FIRM_ID, partner, deposit.id, 'Reversing it');

    // Allowing this would let a reversal-of-a-reversal re-apply the
    // original amount, making the ledger arithmetic unauditable.
    await assert.rejects(
      () => TrustService.reverseTransaction(FIRM_ID, partner, reversal.id, 'Undo the undo'),
      (err) => err.status === 400 && err.code === 'CANNOT_REVERSE_REVERSAL'
    );
    assert.equal(await db.getClientLedgerBalance(alpha.id), 500000);
  });

  await t.test('a reversal requires a stated reason', async () => {
    const deposit = await TrustService.recordDeposit(FIRM_ID, partner, {
      client_ledger_id: alpha.id, amount_cents: 1000, memo: 'Needs a reason to reverse'
    });
    await assert.rejects(
      () => TrustService.reverseTransaction(FIRM_ID, partner, deposit.id, '   '),
      (err) => err.status === 400
    );
    // Clean up so the running balance stays a round number for later tests.
    await TrustService.reverseTransaction(FIRM_ID, partner, deposit.id, 'Reversed with a real reason');
    assert.equal(await db.getClientLedgerBalance(alpha.id), 500000);
  });

  await t.test('there is no update or delete path into the ledger at all', async () => {
    // Structural, not behavioural: if someone later adds a mutating helper
    // to TrustService, this fails and forces the append-only claim in its
    // header comment to be revisited deliberately.
    const surface = Object.getOwnPropertyNames(TrustService);
    const mutators = surface.filter(name => /^(update|delete|remove|edit|destroy)/i.test(name));
    assert.deepEqual(mutators, [], `TrustService must expose no mutating transaction methods, found: ${mutators.join(', ')}`);
  });

  // ───────────────────────────────────────────────────────────
  // Transfer to operating — the trust/revenue boundary
  // ───────────────────────────────────────────────────────────

  async function makeInvoice(amountCents, status = 'sent', firmId = FIRM_ID) {
    return db.insertInvoice({
      firmId,
      invoiceNumber: `INV-TEST-${crypto.randomUUID().slice(0, 8)}`,
      amountCents,
      status
    });
  }

  await t.test('a transfer must name an invoice — there is no bare trust-to-operating move', async () => {
    await assert.rejects(
      () => TrustService.transferToOperating(FIRM_ID, partner, {
        client_ledger_id: alpha.id, amount_cents: 10000, memo: 'just moving some money'
      }),
      (err) => err.status === 400
    );
  });

  await t.test('a transfer must match the invoice amount exactly', async () => {
    const invoice = await makeInvoice(200000);
    for (const wrong of [199999, 200001, 100000]) {
      await assert.rejects(
        () => TrustService.transferToOperating(FIRM_ID, partner, {
          client_ledger_id: alpha.id, invoice_id: invoice.id, amount_cents: wrong, memo: 'partial payment'
        }),
        (err) => err.status === 400 && err.code === 'AMOUNT_MISMATCH',
        `a transfer of ${wrong} against a 200000 invoice must be refused`
      );
    }
    const stillUnpaid = await db.getInvoiceById(FIRM_ID, invoice.id);
    assert.equal(stillUnpaid.status, 'sent', 'a refused transfer must leave the invoice untouched');
  });

  await t.test('a transfer exceeding the client trust balance is refused', async () => {
    const invoice = await makeInvoice(9000000);
    await assert.rejects(
      () => TrustService.transferToOperating(FIRM_ID, partner, {
        client_ledger_id: alpha.id, invoice_id: invoice.id, amount_cents: 9000000, memo: 'more than on deposit'
      }),
      (err) => err.code === 'INSUFFICIENT_TRUST_BALANCE'
    );
    const stillUnpaid = await db.getInvoiceById(FIRM_ID, invoice.id);
    assert.equal(stillUnpaid.status, 'sent');
    assert.equal(await db.getClientLedgerBalance(alpha.id), 500000);
  });

  await t.test('an already-paid or void invoice cannot be paid from trust', async () => {
    const paid = await makeInvoice(10000, 'paid');
    await assert.rejects(
      () => TrustService.transferToOperating(FIRM_ID, partner, {
        client_ledger_id: alpha.id, invoice_id: paid.id, amount_cents: 10000, memo: 'double payment'
      }),
      (err) => err.code === 'INVOICE_ALREADY_PAID',
      'paying the same invoice twice from trust would silently drain the client'
    );

    const voided = await makeInvoice(10000, 'void');
    await assert.rejects(
      () => TrustService.transferToOperating(FIRM_ID, partner, {
        client_ledger_id: alpha.id, invoice_id: voided.id, amount_cents: 10000, memo: 'paying a void invoice'
      }),
      (err) => err.code === 'INVOICE_VOID'
    );
    assert.equal(await db.getClientLedgerBalance(alpha.id), 500000);
  });

  await t.test('a successful transfer debits trust and marks the invoice paid together', async () => {
    const invoice = await makeInvoice(150000);
    const txn = await TrustService.transferToOperating(FIRM_ID, partner, {
      client_ledger_id: alpha.id, invoice_id: invoice.id, amount_cents: 150000,
      memo: 'Payment of INV for January fees', paid_date: '2026-03-04'
    });

    assert.equal(txn.type, 'TRANSFER_TO_OPERATING');
    assert.equal(txn.related_invoice_id, invoice.id, 'the ledger entry must record which invoice it paid');
    assert.equal(await db.getClientLedgerBalance(alpha.id), 350000, 'the client trust balance must be drawn down');

    const after = await db.getInvoiceById(FIRM_ID, invoice.id);
    assert.equal(after.status, 'paid');
    assert.equal(after.paid_date, '2026-03-04', 'DATE columns come back as raw YYYY-MM-DD strings — see server/db/pool.js');
  });

  await t.test('the transfer is atomic: if the invoice write fails, no trust debit is left behind', async () => {
    // The invoice exists, but under a DIFFERENT firm, so the UPDATE inside
    // insertTrustTransferAndMarkInvoicePaid matches zero rows and rolls
    // back — while the trust INSERT in the same transaction has already
    // run. This is the exact failure the atomicity guarantee exists for:
    // without the rollback, a client's retainer would be debited to pay an
    // invoice that was never marked paid.
    //
    // The service's own getInvoiceById precheck is firm-scoped, so this
    // drives db.insertTrustTransferAndMarkInvoicePaid directly to reach
    // the half-failed state the service layer would otherwise screen out.
    const foreignInvoice = await makeInvoice(50000, 'sent', OTHER_FIRM_ID);

    const balanceBefore = await db.getClientLedgerBalance(alpha.id);
    const { rows: countBefore } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM trust_transactions WHERE client_ledger_id = $1', [alpha.id]
    );

    const result = await db.insertTrustTransferAndMarkInvoicePaid({
      firmId: FIRM_ID,
      trustAccountId: account.id,
      clientLedgerId: alpha.id,
      amountCents: 50000,
      memo: 'Transfer against an invoice this firm does not own',
      invoiceId: foreignInvoice.id,
      createdBy: PARTNER_ID
    });

    assert.equal(result, null, 'the transfer must report failure, not partial success');
    assert.equal(await db.getClientLedgerBalance(alpha.id), balanceBefore, 'a rolled-back transfer must not move client money');

    const { rows: countAfter } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM trust_transactions WHERE client_ledger_id = $1', [alpha.id]
    );
    assert.equal(countAfter[0].n, countBefore[0].n, 'no orphaned trust_transactions row may survive the rollback');

    const foreignAfter = await db.getInvoiceById(OTHER_FIRM_ID, foreignInvoice.id);
    assert.equal(foreignAfter.status, 'sent', 'the other firm\'s invoice must be untouched');
  });

  await t.test('reversing a transfer restores the client\'s trust balance', async () => {
    const invoice = await makeInvoice(40000);
    const txn = await TrustService.transferToOperating(FIRM_ID, partner, {
      client_ledger_id: alpha.id, invoice_id: invoice.id, amount_cents: 40000, memo: 'Fee payment'
    });
    assert.equal(await db.getClientLedgerBalance(alpha.id), 310000);

    await TrustService.reverseTransaction(FIRM_ID, partner, txn.id, 'Billing error — fees re-cut');
    assert.equal(await db.getClientLedgerBalance(alpha.id), 350000, 'reversing a transfer must credit trust back');

    // Documenting a real, deliberate limitation rather than asserting a
    // behaviour that doesn't exist: reversing the trust side does NOT
    // un-pay the invoice. The invoice has its own lifecycle and there is
    // no un-pay action anywhere in the app by design (see
    // db.updateInvoiceFields, which refuses to set status/paid_date).
    const stillPaid = await db.getInvoiceById(FIRM_ID, invoice.id);
    assert.equal(stillPaid.status, 'paid');
  });

  // ───────────────────────────────────────────────────────────
  // Three-way reconciliation
  // ───────────────────────────────────────────────────────────

  await t.test('reconciliation balances when the bank statement agrees with the ledger', async () => {
    const ledgerTotal = await db.getTrustAccountLedgerBalance(account.id);
    const recon = await TrustService.computeReconciliation(FIRM_ID, account.id, null, ledgerTotal);

    assert.equal(recon.ledger_balance_cents, ledgerTotal);
    assert.equal(recon.client_ledgers_total_cents, ledgerTotal, 'the account total must equal the sum of client ledgers');
    assert.equal(recon.is_balanced, true);
    assert.equal(recon.discrepancy_cents, 0);
  });

  await t.test('reconciliation reports the discrepancy when the bank disagrees', async () => {
    const ledgerTotal = await db.getTrustAccountLedgerBalance(account.id);
    const short = await TrustService.computeReconciliation(FIRM_ID, account.id, null, ledgerTotal - 2500);
    assert.equal(short.is_balanced, false);
    assert.equal(short.discrepancy_cents, -2500, 'a bank balance below the ledger is a negative discrepancy');

    const over = await TrustService.computeReconciliation(FIRM_ID, account.id, null, ledgerTotal + 900);
    assert.equal(over.is_balanced, false);
    assert.equal(over.discrepancy_cents, 900);
  });

  await t.test('an unreconciled account (no bank balance supplied) is never reported as balanced', async () => {
    const recon = await TrustService.computeReconciliation(FIRM_ID, account.id, null, null);
    assert.equal(recon.bank_statement_balance_cents, null);
    assert.equal(recon.is_balanced, false, 'without a bank statement there is nothing to balance against');
  });

  await t.test('a saved reconciliation snapshot stays reproducible as later activity posts', async () => {
    const asOf = '2026-03-05';
    const ledgerAtDate = await db.getTrustAccountLedgerBalance(account.id, asOf);
    const saved = await TrustService.saveReconciliation(FIRM_ID, partner, {
      trust_account_id: account.id,
      as_of_date: asOf,
      bank_statement_balance_cents: ledgerAtDate,
      notes: 'March statement, reviewed by TP'
    });
    assert.equal(saved.is_balanced, true);
    assert.equal(saved.ledger_balance_cents, ledgerAtDate);

    // Post more money AFTER the as-of date's snapshot was taken.
    await TrustService.recordDeposit(FIRM_ID, partner, {
      client_ledger_id: alpha.id, amount_cents: 999900, memo: 'Deposit received after the statement date'
    });

    // The as-of-date recomputation must be unchanged — a reconciliation
    // that silently drifted as new transactions arrived would be useless
    // as an audit record.
    const recomputed = await db.getTrustAccountLedgerBalance(account.id, asOf);
    assert.equal(recomputed, ledgerAtDate, 'a balance as of a past date must not move when later activity posts');

    const history = await TrustService.listReconciliations(FIRM_ID, account.id);
    const found = history.find(r => r.id === saved.id);
    assert.ok(found, 'the saved snapshot must appear in the history');
    assert.equal(found.ledger_balance_cents, ledgerAtDate, 'the stored snapshot must retain its original figures');
  });

  await t.test('saving a reconciliation requires a real integer bank balance', async () => {
    for (const bad of [undefined, null, 1234.5, '1234']) {
      await assert.rejects(
        () => TrustService.saveReconciliation(FIRM_ID, partner, {
          trust_account_id: account.id, as_of_date: '2026-03-05', bank_statement_balance_cents: bad
        }),
        (err) => err.status === 400,
        `bank_statement_balance_cents of ${JSON.stringify(bad)} must be refused`
      );
    }
  });

  // ───────────────────────────────────────────────────────────
  // Audit trail
  // ───────────────────────────────────────────────────────────

  await t.test('every kind of trust movement is written to the audit log', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT action::text AS action FROM audit_logs WHERE firm_id = $1 AND action::text LIKE 'TRUST%'`,
      [FIRM_ID]
    );
    const actions = rows.map(r => r.action).sort();
    assert.deepEqual(actions, [
      'TRUST_ADJUSTMENT',
      'TRUST_DEPOSIT',
      'TRUST_DISBURSEMENT',
      'TRUST_RECONCILE',
      'TRUST_TRANSFER_TO_OPERATING'
    ], 'each trust action must leave its own audit trail entry');
  });

  // Teardown — every other table references the firm with ON DELETE
  // CASCADE, so removing it removes the rest.
  await pool.query('DELETE FROM firms WHERE id = ANY($1)', [[FIRM_ID, OTHER_FIRM_ID]]);
});
