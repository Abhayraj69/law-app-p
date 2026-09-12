const TrustService = require('../services/trustService');

/**
 * Trust Accounting Controller
 * Maps HTTP request handlers to TrustService. All routes this backs are
 * gated to requireRole('PARTNER') in server/routes/api.js — see
 * trustService.js's own header comment on why trust writes never go
 * through any other path (including the AI copilot).
 */

async function listAccounts(req, res, next) {
  try {
    const accounts = await TrustService.listAccounts(req.tenantId);
    res.json({ success: true, data: accounts });
  } catch (err) {
    next(err);
  }
}

async function createAccount(req, res, next) {
  try {
    const created = await TrustService.createAccount(req.tenantId, req.user, req.body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

async function listClientLedgers(req, res, next) {
  try {
    const ledgers = await TrustService.listClientLedgers(req.tenantId, req.query.trust_account_id);
    res.json({ success: true, data: ledgers });
  } catch (err) {
    next(err);
  }
}

async function createClientLedger(req, res, next) {
  try {
    const created = await TrustService.createClientLedger(req.tenantId, req.user, req.body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

async function listTransactions(req, res, next) {
  try {
    const rows = await TrustService.listTransactions(req.tenantId, req.params.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

async function recordDeposit(req, res, next) {
  try {
    const txn = await TrustService.recordDeposit(req.tenantId, req.user, req.body);
    res.status(201).json({ success: true, data: txn });
  } catch (err) {
    next(err);
  }
}

async function recordDisbursement(req, res, next) {
  try {
    const txn = await TrustService.recordDisbursement(req.tenantId, req.user, req.body);
    res.status(201).json({ success: true, data: txn });
  } catch (err) {
    next(err);
  }
}

async function transferToOperating(req, res, next) {
  try {
    const txn = await TrustService.transferToOperating(req.tenantId, req.user, req.body);
    res.status(201).json({ success: true, data: txn });
  } catch (err) {
    next(err);
  }
}

async function reverseTransaction(req, res, next) {
  try {
    const txn = await TrustService.reverseTransaction(req.tenantId, req.user, req.params.id, req.body?.reason);
    res.status(201).json({ success: true, data: txn });
  } catch (err) {
    next(err);
  }
}

async function getReconciliation(req, res, next) {
  try {
    const { trust_account_id, as_of, bank_balance_cents } = req.query;
    if (!trust_account_id) throw Object.assign(new Error('trust_account_id is required.'), { status: 400 });
    const bankBalance = bank_balance_cents !== undefined ? parseInt(bank_balance_cents, 10) : undefined;
    const result = await TrustService.computeReconciliation(req.tenantId, trust_account_id, as_of, bankBalance);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function saveReconciliation(req, res, next) {
  try {
    const row = await TrustService.saveReconciliation(req.tenantId, req.user, req.body);
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
}

async function listReconciliationHistory(req, res, next) {
  try {
    const rows = await TrustService.listReconciliations(req.tenantId, req.query.trust_account_id);
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listAccounts,
  createAccount,
  listClientLedgers,
  createClientLedger,
  listTransactions,
  recordDeposit,
  recordDisbursement,
  transferToOperating,
  reverseTransaction,
  getReconciliation,
  saveReconciliation,
  listReconciliationHistory
};
