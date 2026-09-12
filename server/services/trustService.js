const db = require('../db');

/**
 * Trust Accounting Service
 *
 * Client trust funds (retainers) are money the firm holds but does not
 * own — segregating them from operating revenue (invoices.amount_cents)
 * is a bar-discipline requirement in most US jurisdictions, not just good
 * bookkeeping. This service is the ONLY write path to trust_transactions;
 * every route that reaches it is gated to PARTNER+ in server/routes/api.js
 * (requireRole('PARTNER')), and nothing here is registered as a copilot
 * tool (see copilotController.js's tool schemas) — trust money never
 * moves as a side effect of an AI action, only a staff-form submission.
 *
 * trust_transactions is append-only: there is no updateTransaction or
 * deleteTransaction anywhere in this file. A correction is always a new
 * ADJUSTMENT_REVERSAL row via reverseTransaction() below, so the ledger
 * itself is always a complete, untampered paper trail — the same
 * reasoning audit_logs already applies to every other write in this app,
 * just enforced structurally here instead of only logged.
 */

function notFound(what) {
  const err = new Error(`${what} not found.`);
  err.status = 404;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function validateAmountCents(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw badRequest('amount_cents must be a positive integer (money in whole cents).');
  }
  return amountCents;
}

function validateMemo(memo) {
  if (!memo || !String(memo).trim()) {
    throw badRequest('A memo describing the transaction is required for every trust entry.');
  }
  return String(memo).trim();
}

async function assertLedgerInFirm(tenantId, ledgerId) {
  const ledger = await db.getClientLedgerById(tenantId, ledgerId);
  if (!ledger) throw notFound('Client trust ledger');
  return ledger;
}

function toLedgerView(row) {
  return {
    id: row.id,
    trust_account_id: row.trust_account_id,
    trust_account_name: row.trust_account_name,
    client_display_name: row.client_display_name,
    client_user_id: row.client_user_id,
    balance_cents: row.balance_cents !== undefined ? Number(row.balance_cents) : undefined,
    last_activity_at: row.last_activity_at || null,
    is_active: row.is_active,
    created_at: row.created_at
  };
}

function toTransactionView(row) {
  return {
    id: row.id,
    client_ledger_id: row.client_ledger_id,
    trust_account_id: row.trust_account_id,
    case_id: row.case_id,
    type: row.type,
    amount_cents: row.amount_cents,
    memo: row.memo,
    check_number: row.check_number,
    related_invoice_id: row.related_invoice_id,
    reverses_transaction_id: row.reverses_transaction_id,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    created_at: row.created_at
  };
}

function toReconciliationView(row) {
  return {
    id: row.id,
    trust_account_id: row.trust_account_id,
    as_of_date: row.as_of_date,
    bank_statement_balance_cents: row.bank_statement_balance_cents,
    ledger_balance_cents: row.ledger_balance_cents,
    client_ledgers_total_cents: row.client_ledgers_total_cents,
    is_balanced: row.is_balanced,
    discrepancy_cents: row.discrepancy_cents,
    notes: row.notes,
    performed_by: row.performed_by,
    performed_by_name: row.performed_by_name,
    created_at: row.created_at
  };
}

class TrustService {
  /** GET /api/v1/trust/accounts */
  static async listAccounts(tenantId) {
    return db.listTrustAccounts(tenantId);
  }

  /** POST /api/v1/trust/accounts — register a new trust bank account. */
  static async createAccount(tenantId, actingUser, payload = {}) {
    const { account_name, bank_name, account_number_last4 } = payload;
    if (!account_name || !account_name.trim()) throw badRequest('account_name is required.');
    if (!bank_name || !bank_name.trim()) throw badRequest('bank_name is required.');
    if (!/^\d{4}$/.test(String(account_number_last4 || ''))) {
      throw badRequest('account_number_last4 must be exactly 4 digits — never store a full account number.');
    }

    return db.insertTrustAccount({
      firmId: tenantId,
      accountName: account_name.trim(),
      bankName: bank_name.trim(),
      accountNumberLast4: String(account_number_last4)
    });
  }

  /** GET /api/v1/trust/client-ledgers?trust_account_id= */
  static async listClientLedgers(tenantId, trustAccountId) {
    const rows = await db.listClientLedgersWithBalances(tenantId, trustAccountId || null);
    return rows.map(toLedgerView);
  }

  /**
   * POST /api/v1/trust/client-ledgers — opens a new per-client sub-ledger
   * under a trust account. Idempotent by (trust_account_id,
   * client_display_name) — resubmitting the same client name reactivates
   * rather than duplicates (see db.insertClientLedger's ON CONFLICT).
   */
  static async createClientLedger(tenantId, actingUser, payload = {}) {
    const { trust_account_id, client_display_name, client_user_id } = payload;
    if (!trust_account_id) throw badRequest('trust_account_id is required.');
    if (!client_display_name || !client_display_name.trim()) throw badRequest('client_display_name is required.');

    const account = await db.getTrustAccountById(tenantId, trust_account_id);
    if (!account) throw notFound('Trust account');

    const ledger = await db.insertClientLedger({
      firmId: tenantId,
      trustAccountId: trust_account_id,
      clientDisplayName: client_display_name.trim(),
      clientUserId: client_user_id || null
    });
    return toLedgerView({ ...ledger, trust_account_name: account.account_name, balance_cents: 0 });
  }

  /** GET /api/v1/trust/client-ledgers/:id/transactions */
  static async listTransactions(tenantId, ledgerId) {
    await assertLedgerInFirm(tenantId, ledgerId);
    const rows = await db.listTrustTransactionsForLedger(tenantId, ledgerId);
    return rows.map(toTransactionView);
  }

  /**
   * POST /api/v1/trust/deposits — funds received into a client's trust
   * sub-ledger (a retainer check, a settlement deposit, etc).
   */
  static async recordDeposit(tenantId, actingUser, payload = {}) {
    const { client_ledger_id, amount_cents, memo, case_id, check_number } = payload;
    const ledger = await assertLedgerInFirm(tenantId, client_ledger_id);
    const amount = validateAmountCents(amount_cents);
    const validatedMemo = validateMemo(memo);

    const txn = await db.insertTrustTransaction({
      firmId: tenantId,
      trustAccountId: ledger.trust_account_id,
      clientLedgerId: ledger.id,
      caseId: case_id || null,
      type: 'DEPOSIT',
      amountCents: amount,
      memo: validatedMemo,
      checkNumber: check_number || null,
      createdBy: actingUser.id
    });

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser.id,
      action: 'TRUST_DEPOSIT',
      details: { transaction_id: txn.id, client_ledger_id: ledger.id, amount_cents: amount }
    });

    return toTransactionView(txn);
  }

  /**
   * POST /api/v1/trust/disbursements — funds paid out of a client's trust
   * sub-ledger directly (e.g. a filing fee paid from retainer, a refund of
   * unused retainer). Rejected if it would take the ledger negative —
   * you cannot disburse funds a client doesn't have on deposit.
   */
  static async recordDisbursement(tenantId, actingUser, payload = {}) {
    const { client_ledger_id, amount_cents, memo, case_id, check_number } = payload;
    const ledger = await assertLedgerInFirm(tenantId, client_ledger_id);
    const amount = validateAmountCents(amount_cents);
    const validatedMemo = validateMemo(memo);

    const currentBalance = await db.getClientLedgerBalance(ledger.id);
    if (amount > currentBalance) {
      throw badRequest(
        `Disbursement of ${(amount / 100).toFixed(2)} exceeds this client's trust balance of ${(currentBalance / 100).toFixed(2)}.`,
        'INSUFFICIENT_TRUST_BALANCE'
      );
    }

    const txn = await db.insertTrustTransaction({
      firmId: tenantId,
      trustAccountId: ledger.trust_account_id,
      clientLedgerId: ledger.id,
      caseId: case_id || null,
      type: 'DISBURSEMENT',
      amountCents: amount,
      memo: validatedMemo,
      checkNumber: check_number || null,
      createdBy: actingUser.id
    });

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser.id,
      action: 'TRUST_DISBURSEMENT',
      details: { transaction_id: txn.id, client_ledger_id: ledger.id, amount_cents: amount }
    });

    return toTransactionView(txn);
  }

  /**
   * POST /api/v1/trust/transfers — the ONLY path by which money moves
   * from a trust ledger into firm operating revenue: it draws down the
   * client's trust balance and marks the named invoice paid, atomically
   * (db.insertTrustTransferAndMarkInvoicePaid runs both writes in one
   * transaction). A direct trust-to-operating transfer with no invoice
   * behind it is deliberately not offered — see the schema proposal this
   * followed: transfers must always be a side effect of billing.
   */
  static async transferToOperating(tenantId, actingUser, payload = {}) {
    const { client_ledger_id, invoice_id, amount_cents, memo, case_id, paid_date } = payload;
    const ledger = await assertLedgerInFirm(tenantId, client_ledger_id);
    if (!invoice_id) throw badRequest('invoice_id is required — a transfer to operating must be tied to an invoice.');
    const amount = validateAmountCents(amount_cents);
    const validatedMemo = validateMemo(memo);

    const invoice = await db.getInvoiceById(tenantId, invoice_id);
    if (!invoice) throw notFound('Invoice');
    if (invoice.status === 'paid') throw badRequest('That invoice is already marked paid.', 'INVOICE_ALREADY_PAID');
    if (invoice.status === 'void') throw badRequest('A void invoice cannot be paid from trust.', 'INVOICE_VOID');
    if (amount !== Number(invoice.amount_cents)) {
      throw badRequest(
        `Transfer amount (${(amount / 100).toFixed(2)}) must match the invoice amount (${(Number(invoice.amount_cents) / 100).toFixed(2)}).`,
        'AMOUNT_MISMATCH'
      );
    }

    const currentBalance = await db.getClientLedgerBalance(ledger.id);
    if (amount > currentBalance) {
      throw badRequest(
        `Transfer of ${(amount / 100).toFixed(2)} exceeds this client's trust balance of ${(currentBalance / 100).toFixed(2)}.`,
        'INSUFFICIENT_TRUST_BALANCE'
      );
    }

    const txn = await db.insertTrustTransferAndMarkInvoicePaid({
      firmId: tenantId,
      trustAccountId: ledger.trust_account_id,
      clientLedgerId: ledger.id,
      caseId: case_id || null,
      amountCents: amount,
      memo: validatedMemo,
      invoiceId: invoice_id,
      createdBy: actingUser.id,
      paidDate: paid_date || null
    });
    if (!txn) throw notFound('Invoice');

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser.id,
      action: 'TRUST_TRANSFER_TO_OPERATING',
      details: { transaction_id: txn.id, client_ledger_id: ledger.id, invoice_id: invoice_id, amount_cents: amount }
    });

    return toTransactionView(txn);
  }

  /**
   * POST /api/v1/trust/transactions/:id/reverse — corrects a prior entry
   * without ever mutating or deleting it. reason becomes the reversal
   * row's memo, so the "why" is preserved in the ledger itself, not just
   * in the audit log.
   */
  static async reverseTransaction(tenantId, actingUser, transactionId, reason) {
    const original = await db.getTrustTransactionById(tenantId, transactionId);
    if (!original) throw notFound('Trust transaction');
    if (original.type === 'ADJUSTMENT_REVERSAL') {
      throw badRequest('A reversal entry cannot itself be reversed — reverse the original transaction instead.', 'CANNOT_REVERSE_REVERSAL');
    }
    const validatedReason = validateMemo(reason);

    const txn = await db.insertTrustTransaction({
      firmId: tenantId,
      trustAccountId: original.trust_account_id,
      clientLedgerId: original.client_ledger_id,
      caseId: original.case_id,
      type: 'ADJUSTMENT_REVERSAL',
      amountCents: original.amount_cents,
      memo: validatedReason,
      reversesTransactionId: original.id,
      createdBy: actingUser.id
    });

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser.id,
      action: 'TRUST_ADJUSTMENT',
      details: { transaction_id: txn.id, reverses_transaction_id: original.id, client_ledger_id: original.client_ledger_id }
    });

    return toTransactionView(txn);
  }

  /**
   * GET /api/v1/trust/reconciliation?trust_account_id=&as_of=&bank_balance_cents=
   * Computes the three-way check live — bank_balance_cents is supplied by
   * the caller (it comes off a paper/PDF bank statement, never derived
   * from application data) and is not persisted here; use
   * saveReconciliation to record a snapshot once it's been reviewed.
   */
  static async computeReconciliation(tenantId, trustAccountId, asOfDate, bankBalanceCents) {
    const account = await db.getTrustAccountById(tenantId, trustAccountId);
    if (!account) throw notFound('Trust account');

    const ledgerBalance = await db.getTrustAccountLedgerBalance(trustAccountId, asOfDate || null);
    const clientLedgersTotal = await db.getTrustAccountClientLedgersTotal(trustAccountId, asOfDate || null);
    const bankBalance = bankBalanceCents !== undefined && bankBalanceCents !== null ? Number(bankBalanceCents) : null;

    const isBalanced = bankBalance !== null && bankBalance === ledgerBalance && ledgerBalance === clientLedgersTotal;
    const discrepancy = bankBalance !== null ? bankBalance - ledgerBalance : 0;

    return {
      trust_account_id: trustAccountId,
      as_of_date: asOfDate || new Date().toISOString().slice(0, 10),
      bank_statement_balance_cents: bankBalance,
      ledger_balance_cents: ledgerBalance,
      client_ledgers_total_cents: clientLedgersTotal,
      is_balanced: isBalanced,
      discrepancy_cents: discrepancy
    };
  }

  /** POST /api/v1/trust/reconciliation — persists a reviewed snapshot. */
  static async saveReconciliation(tenantId, actingUser, payload = {}) {
    const { trust_account_id, as_of_date, bank_statement_balance_cents, notes } = payload;
    if (!trust_account_id) throw badRequest('trust_account_id is required.');
    if (!as_of_date) throw badRequest('as_of_date is required.');
    if (!Number.isInteger(bank_statement_balance_cents)) {
      throw badRequest('bank_statement_balance_cents must be an integer (whole cents) taken from the bank statement.');
    }

    const computed = await TrustService.computeReconciliation(tenantId, trust_account_id, as_of_date, bank_statement_balance_cents);

    const row = await db.insertTrustReconciliation({
      firmId: tenantId,
      trustAccountId: trust_account_id,
      asOfDate: as_of_date,
      bankStatementBalanceCents: computed.bank_statement_balance_cents,
      ledgerBalanceCents: computed.ledger_balance_cents,
      clientLedgersTotalCents: computed.client_ledgers_total_cents,
      isBalanced: computed.is_balanced,
      discrepancyCents: computed.discrepancy_cents,
      notes: notes || null,
      performedBy: actingUser.id
    });

    await db.insertAuditLog({
      firmId: tenantId,
      userId: actingUser.id,
      action: 'TRUST_RECONCILE',
      details: {
        reconciliation_id: row.id, trust_account_id, as_of_date,
        is_balanced: row.is_balanced, discrepancy_cents: row.discrepancy_cents
      }
    });

    return toReconciliationView(row);
  }

  /** GET /api/v1/trust/reconciliation/history?trust_account_id= */
  static async listReconciliations(tenantId, trustAccountId) {
    if (!trustAccountId) throw badRequest('trust_account_id is required.');
    const rows = await db.listTrustReconciliations(tenantId, trustAccountId);
    return rows.map(toReconciliationView);
  }
}

module.exports = TrustService;
