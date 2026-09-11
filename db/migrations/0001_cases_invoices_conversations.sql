-- ═════════════════════════════════════════════════════════════════════
-- 0001: Back the Dashboard, Active Cases and Client Communications pages
--
-- These three pages previously rendered from hardcoded arrays in app.js.
-- Making them real needs three things the baseline schema didn't have:
--   1. A few extra columns on `cases` that the Cases page displays.
--   2. An `invoices` table (the dashboard reports overdue invoices and
--      monthly billing).
--   3. Threaded `conversations` + `conversation_messages` (the existing
--      `client_messages` table is a flat list powering the vault sidebar
--      widget, not a message thread).
-- ═════════════════════════════════════════════════════════════════════

-- 1. CASES — columns the Active Cases page needs
ALTER TABLE cases ADD COLUMN IF NOT EXISTS opposing_counsel VARCHAR(255);

-- Links a CLIENT-role portal user to the cases that are theirs. Role-based
-- visibility depends on this: a CLIENT may only ever read rows where this
-- matches their own user id. NULL means "no portal user attached", which a
-- CLIENT can therefore never match.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS client_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cases_firm_status ON cases(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_cases_client_user ON cases(client_user_id);

-- 2. INVOICES
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    case_id VARCHAR(50) REFERENCES cases(id) ON DELETE SET NULL,
    invoice_number VARCHAR(50) NOT NULL,
    -- Stored in minor units (cents) so money never touches a float.
    amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')),
    issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    paid_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_invoice_number_per_firm UNIQUE (firm_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_firm_status ON invoices(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_issued ON invoices(firm_id, issued_date);

-- 3. CONVERSATIONS (threaded client communications)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    case_id VARCHAR(50) REFERENCES cases(id) ON DELETE SET NULL,
    -- Same rule as cases.client_user_id: a CLIENT may only read threads
    -- where this equals their own user id.
    client_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    client_name VARCHAR(255) NOT NULL,
    client_initials VARCHAR(10),
    client_color VARCHAR(20) DEFAULT '#C9A84C',
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversations_firm ON conversations(firm_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_client_user ON conversations(client_user_id);

-- Postgres has no `CREATE TYPE IF NOT EXISTS` — wrapped in a DO block so
-- this file stays safe to run if it's ever applied twice against the same
-- database outside the normal schema_migrations tracking (e.g. two
-- processes racing to apply migrations concurrently; the advisory lock in
-- server/db/migrate.js prevents that in practice, but this is a second,
-- cheap layer of defense with no downside).
DO $$ BEGIN
    CREATE TYPE message_sender AS ENUM ('client', 'staff', 'note');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS conversation_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    -- 'note' is an internal staff-only annotation: it is filtered out of
    -- every response served to a CLIENT-role user.
    sender message_sender NOT NULL,
    sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
    ON conversation_messages(conversation_id, created_at ASC);
