-- ═════════════════════════════════════════════════════════════════════
-- SLF Legal Practice Management - Document Vault Database Schema
-- Dialect: PostgreSQL (12+)
-- ═════════════════════════════════════════════════════════════════════

-- Enable UUID extension if not present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. FIRMS / TENANTS (Multi-Tenant Isolation)
CREATE TABLE IF NOT EXISTS firms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. USERS & ROLES (RBAC)
CREATE TYPE user_role AS ENUM ('PARTNER', 'SENIOR_PARTNER', 'ASSOCIATE', 'PARALEGAL', 'ADMIN', 'CLIENT');

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'ASSOCIATE',
    initials VARCHAR(10),
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. CASES
CREATE TABLE IF NOT EXISTS cases (
    id VARCHAR(50) PRIMARY KEY, -- e.g., 'LC-2026-001'
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    case_name VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    opposing_party VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, pending, urgent, closed
    lead_attorney_id UUID REFERENCES users(id),
    case_type VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. FOLDERS (Nested Hierarchy)
CREATE TYPE folder_category AS ENUM ('Case Files', 'Practice Templates', 'Secure Shared', 'Archived');

CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    folder_name VARCHAR(255) NOT NULL,
    category folder_category NOT NULL DEFAULT 'Case Files',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_folder_per_parent UNIQUE (firm_id, parent_id, folder_name)
);

-- 5. DOCUMENTS / FILES
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL, -- e.g., 'application/pdf'
    extension VARCHAR(20) NOT NULL,   -- e.g., 'pdf', 'docx', 'xlsx'
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes >= 0),
    storage_path_url TEXT NOT NULL,   -- S3 key or file path
    preview_path_url TEXT,            -- Rendered SVG/PNG/PDF preview URL
    case_id VARCHAR(50) REFERENCES cases(id) ON DELETE SET NULL,
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    version INT NOT NULL DEFAULT 1,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE, -- Soft delete
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. TAGS & DOCUMENT_TAGS (Many-to-Many Relationship)
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color_code VARCHAR(20) DEFAULT '#C9A84C',
    CONSTRAINT unique_tag_per_firm UNIQUE (firm_id, name)
);

CREATE TABLE IF NOT EXISTS document_tags (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);

-- 7. STORAGE ALLOCATION & USAGE
CREATE TABLE IF NOT EXISTS storage_quotas (
    firm_id UUID PRIMARY KEY REFERENCES firms(id) ON DELETE CASCADE,
    storage_limit_bytes BIGINT NOT NULL DEFAULT 107374182400, -- Default 100 GB
    storage_used_bytes BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. DOCUMENT SHARES (Tokenized External & Internal Sharing)
CREATE TYPE share_permission AS ENUM ('VIEW', 'EDIT');

CREATE TABLE IF NOT EXISTS document_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    shared_by UUID NOT NULL REFERENCES users(id),
    recipient_email VARCHAR(255) NOT NULL,
    share_token VARCHAR(255) UNIQUE NOT NULL,
    permission share_permission NOT NULL DEFAULT 'VIEW',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    access_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. ACTIVITY & AUDIT LOGS
CREATE TYPE audit_action AS ENUM (
    'UPLOAD', 'VIEW', 'PREVIEW', 'DOWNLOAD', 'SHARE', 
    'UPDATE_METADATA', 'DELETE', 'FLAG', 'UNFLAG', 'CREATE_FOLDER'
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    action audit_action NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. WIDGET DATA TABLES (Client Messages & Deadlines)
CREATE TABLE IF NOT EXISTS client_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    client_avatar VARCHAR(10),
    subject VARCHAR(255) NOT NULL,
    preview TEXT NOT NULL,
    timestamp_text VARCHAR(50) NOT NULL,
    is_unread BOOLEAN DEFAULT TRUE,
    is_urgent BOOLEAN DEFAULT FALSE,
    attachment_name VARCHAR(255),
    attachment_size VARCHAR(50),
    attachment_doc_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_deadlines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    case_id VARCHAR(50) REFERENCES cases(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    deadline_date DATE NOT NULL,
    time_text VARCHAR(50),
    badge_type VARCHAR(50) DEFAULT 'Hearing', -- Hearing, Discovery, Filing, Trial
    badge_color VARCHAR(20) DEFAULT '#C9A84C',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ═════════════════════════════════════════════════════════════════════
-- INDEXES FOR HIGH-PERFORMANCE QUERYING
-- ═════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_documents_firm_folder ON documents(firm_id, folder_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_documents_search ON documents USING gin(to_tsvector('english', file_name || ' ' || original_name));
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(firm_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_document ON audit_logs(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_firm ON audit_logs(firm_id, created_at DESC);

-- ═════════════════════════════════════════════════════════════════════
-- TRIGGER FOR AUTOMATIC STORAGE QUOTA UPDATES
-- ═════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_firm_storage_quota()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE storage_quotas
        SET storage_used_bytes = storage_used_bytes + NEW.file_size_bytes,
            updated_at = CURRENT_TIMESTAMP
        WHERE firm_id = NEW.firm_id;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE storage_quotas
        SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.file_size_bytes),
            updated_at = CURRENT_TIMESTAMP
        WHERE firm_id = OLD.firm_id;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD.is_deleted = FALSE AND NEW.is_deleted = TRUE THEN
            UPDATE storage_quotas
            SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.file_size_bytes),
                updated_at = CURRENT_TIMESTAMP
            WHERE firm_id = OLD.firm_id;
        ELSIF OLD.is_deleted = TRUE AND NEW.is_deleted = FALSE THEN
            UPDATE storage_quotas
            SET storage_used_bytes = storage_used_bytes + NEW.file_size_bytes,
                updated_at = CURRENT_TIMESTAMP
            WHERE firm_id = NEW.firm_id;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_document_storage_quota ON documents;
CREATE TRIGGER trigger_document_storage_quota
AFTER INSERT OR DELETE OR UPDATE OF is_deleted ON documents
FOR EACH ROW EXECUTE FUNCTION update_firm_storage_quota();
