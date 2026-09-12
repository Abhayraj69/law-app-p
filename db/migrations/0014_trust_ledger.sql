-- ═════════════════════════════════════════════════════════════════════
-- 0014: Trust accounting (client trust funds, segregated from operating
-- revenue)
--
-- invoices.amount_cents (0001) has always been straight firm revenue —
-- there was no way to record money the firm holds on a client's behalf
-- (retainers) as distinct from money the firm has actually earned. Most
-- US jurisdictions treat commingling those, even structurally, as a
-- bar-discipline matter independent of whether any specific dollar is
-- ever misapplied. This migration adds a self-contained trust ledger:
--
--   trust_accounts        — one row per real-world trust bank account
--   trust_client_ledgers  — per-client sub-ledger within a trust account
--   trust_transactions    — append-only ledger entries (deposit,
--                           disbursement, transfer to operating, reversal)
--   trust_reconciliations — a saved three-way-reconciliation snapshot
--
-- trust_transactions is deliberately append-only: there is no UPDATE or
-- DELETE path anywhere in this codebase for it (see trustService.js) — a
-- correction is always a new ADJUSTMENT_REVERSAL row referencing the
-- entry it reverses, so the ledger itself is always a complete,
-- untampered paper trail. The only bridge to operating accounting is
-- TRANSFER_TO_OPERATING, and that always carries a related_invoice_id —
-- money leaves trust and becomes firm revenue only as a side effect of
-- billing against a real invoice, never as a direct disbursement to the
-- firm itself.
-- ═════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'TRUST_DEPOSIT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'TRUST_DISBURSEMENT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'TRUST_TRANSFER_TO_OPERATING';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'TRUST_ADJUSTMENT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'TRUST_RECONCILE';

-- 1. TRUST ACCOUNTS — one row per real-world trust bank account the firm
-- holds. account_number_last4 only (never the full account number) —
-- same "don't store more than needed" posture as the rest of this app.
CREATE TABLE IF NOT EXISTS trust_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    account_name VARCHAR(255) NOT NULL,
    bank_name VARCHAR(255) NOT NULL,
    account_number_last4 VARCHAR(4) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trust_accounts_firm ON trust_accounts(firm_id);

-- 2. TRUST CLIENT LEDGERS — the per-client sub-ledger a trust account is
-- pooled from. This app has no standalone `clients` table (cases only
-- carry a free-text client_name plus an optional client_user_id portal
-- link) — client_display_name plus an optional client_user_id is the
-- closest thing to a client identity available, so that's what this
-- keys on rather than inventing a full CRM as part of a compliance fix.
CREATE TABLE IF NOT EXISTS trust_client_ledgers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    trust_account_id UUID NOT NULL REFERENCES trust_accounts(id),
    client_display_name VARCHAR(255) NOT NULL,
    client_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_client_ledger_per_account UNIQUE (firm_id, trust_account_id, client_display_name)
);

CREATE INDEX IF NOT EXISTS idx_trust_client_ledgers_firm ON trust_client_ledgers(firm_id, trust_account_id);

-- 3. TRUST TRANSACTIONS — append-only. No application code path ever
-- UPDATEs or DELETEs a row here (see trustService.js); a correction is a
-- new ADJUSTMENT_REVERSAL row that references the entry it reverses via
-- reverses_transaction_id. amount_cents is always positive — direction
-- comes from `type`, never a signed amount, so a sign-flip bug can never
-- silently invert a deposit into a disbursement or vice versa.
CREATE TYPE trust_transaction_type AS ENUM (
    'DEPOSIT', 'DISBURSEMENT', 'TRANSFER_TO_OPERATING', 'ADJUSTMENT_REVERSAL'
);

CREATE TABLE IF NOT EXISTS trust_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    trust_account_id UUID NOT NULL REFERENCES trust_accounts(id),
    client_ledger_id UUID NOT NULL REFERENCES trust_client_ledgers(id),
    case_id VARCHAR(50) REFERENCES cases(id) ON DELETE SET NULL,
    type trust_transaction_type NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    memo TEXT NOT NULL,
    check_number VARCHAR(50),
    related_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    reverses_transaction_id UUID REFERENCES trust_transactions(id),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trust_txn_ledger ON trust_transactions(client_ledger_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trust_txn_account ON trust_transactions(trust_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trust_txn_firm ON trust_transactions(firm_id, created_at);

-- 4. TRUST RECONCILIATIONS — a saved snapshot each time staff perform the
-- three-way check (bank statement balance vs. ledger balance vs. sum of
-- client ledger balances), so there is an audit trail of *when*
-- reconciliation happened, not just a live number computed on demand.
CREATE TABLE IF NOT EXISTS trust_reconciliations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    trust_account_id UUID NOT NULL REFERENCES trust_accounts(id),
    as_of_date DATE NOT NULL,
    bank_statement_balance_cents BIGINT NOT NULL,
    ledger_balance_cents BIGINT NOT NULL,
    client_ledgers_total_cents BIGINT NOT NULL,
    is_balanced BOOLEAN NOT NULL,
    discrepancy_cents BIGINT NOT NULL DEFAULT 0,
    notes TEXT,
    performed_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trust_recon_account ON trust_reconciliations(trust_account_id, as_of_date DESC);
