-- ═════════════════════════════════════════════════════════════════════
-- 0021: Time tracking + invoice line items
--
-- Invoices until now were a single flat amount_cents with no record of
-- what the number was FOR — a real gap for a legal billing system, where
-- an invoice is normally a rolled-up statement of billable hours against
-- a matter. This adds:
--
--   time_entries        — draft billable hours logged by staff against a
--                          case, before they're ever billed.
--   invoice_line_items   — the itemized breakdown an invoice is generated
--                          from, when it was generated from time entries.
--
-- Design choices, in order of what they protect against:
--
-- 1. invoice_line_items is created BEFORE time_entries so time_entries can
--    carry a nullable FK back to the line item it ended up on, without a
--    circular-dependency problem at migration time.
--
-- 2. Money stays in whole cents (amount_cents, rate_cents), same rule as
--    invoices.amount_cents and every other money column in this schema —
--    it never touches a float.
--
-- 3. Time is stored in whole minutes (not fractional hours as a decimal),
--    for the same reason: a NUMERIC hour value invites silent rounding
--    drift the first time it's multiplied by a rate and divided back.
--    minutes is an exact integer; the hours a UI displays are computed
--    from it, never stored as a second, driftable source of truth.
--
-- 4. rate_cents is captured on the row itself at the moment an entry is
--    logged (or a line item is generated), not looked up live from a
--    mutable "current rate" elsewhere. A rate change next quarter must
--    never retroactively change what a linked invoice already claims it
--    charged for a specific hour of work already billed.
--
-- 5. invoice_line_items.amount_cents is stored, not computed on read, for
--    the same historical-record reason — even though it always starts as
--    round(quantity_minutes / 60 * rate_cents) at creation time.
--
-- 6. A time entry moves through unbilled -> invoiced (or -> written_off)
--    and, once invoiced, becomes immutable at the application layer (see
--    TimeEntryService) — the same "append-only once it has financial
--    consequences" posture db/migrations/0014_trust_ledger.sql took for
--    trust_transactions, just enforced in the service rather than by the
--    schema, because an UNBILLED entry is a genuine draft (editing or
--    deleting your own not-yet-invoiced time is completely normal) in a
--    way a posted trust transaction never is.
-- ═════════════════════════════════════════════════════════════════════

-- A default hourly rate for each staff user, used to prefill a new time
-- entry (which then stores its OWN rate_cents — see point 4 above, this
-- column is only ever a starting suggestion, never read again after an
-- entry is created). NULL for CLIENT-role users, who never log time.
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_rate_cents BIGINT CHECK (default_rate_cents IS NULL OR default_rate_cents >= 0);

CREATE TABLE IF NOT EXISTS invoice_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity_minutes INTEGER NOT NULL CHECK (quantity_minutes > 0),
    rate_cents BIGINT NOT NULL CHECK (rate_cents >= 0),
    amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_firm ON invoice_line_items(firm_id);

CREATE TABLE IF NOT EXISTS time_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    -- Required, not nullable: a time entry with no case is untracked
    -- overhead, not billable work, and this feature exists to bill work.
    case_id VARCHAR(50) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    -- Who performed the work — distinct from whoever later approves an
    -- invoice built from it.
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    minutes INTEGER NOT NULL CHECK (minutes > 0),
    rate_cents BIGINT NOT NULL CHECK (rate_cents >= 0),
    description TEXT NOT NULL,
    billable BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'unbilled'
        CHECK (status IN ('unbilled', 'invoiced', 'written_off')),
    -- Set the moment this entry is rolled into a generated invoice; NULL
    -- for every entry still in draft. ON DELETE SET NULL rather than
    -- CASCADE: if a line item were ever deleted independently (it isn't,
    -- today — line items only go away with their invoice, which cascades
    -- from invoice_id above), the underlying time record should survive
    -- as a fact of work performed, not vanish with the billing artifact.
    invoice_line_item_id UUID REFERENCES invoice_line_items(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_time_entries_firm_case ON time_entries(firm_id, case_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_firm_user ON time_entries(firm_id, user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_firm_status ON time_entries(firm_id, status);

-- New privileged write paths, same reasoning as every prior audit-action
-- addition (0002/0004/0010/0011/0020): each one gets its own action rather
-- than folding into a generic 'UPDATE' or reusing CREATE_INVOICE, so the
-- audit log can distinguish "an invoice was created from a flat amount"
-- from "an invoice was generated by rolling up specific time entries."
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CREATE_TIME_ENTRY';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPDATE_TIME_ENTRY';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'DELETE_TIME_ENTRY';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'GENERATE_INVOICE_FROM_TIME';
