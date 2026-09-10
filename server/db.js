const path = require('path');
const fs = require('fs');

/**
 * Database Abstraction Layer
 * Supports PostgreSQL connection via 'pg' module if PGHOST or DATABASE_URL is configured,
 * otherwise provides high-performance in-memory dataset matching schema.sql.
 */

let pool = null;
if (process.env.PGHOST || process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      host: process.env.PGHOST,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      port: process.env.PGPORT || 5432,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
    });
    console.log('[DB] PostgreSQL pool initialized');
  } catch (err) {
    console.warn('[DB] Failed to initialize PostgreSQL pool, using in-memory provider:', err.message);
  }
}

// In-Memory Data Store (Used when PostgreSQL is offline or running standalone)
const DEFAULT_FIRM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const DEFAULT_USER_ID = 'u101ac10b-58cc-4372-a567-0e02b2c3d479';

const inMemoryDb = {
  firms: [
    { id: DEFAULT_FIRM_ID, name: 'Sterling Jennings & Partners LLP', domain: 'slf.law' }
  ],
  users: [
    {
      id: DEFAULT_USER_ID,
      firm_id: DEFAULT_FIRM_ID,
      email: 's.jennings@slf.law',
      full_name: 'Sarah Jennings',
      role: 'SENIOR_PARTNER',
      initials: 'SJ'
    },
    {
      id: 'u102ac10b-58cc-4372-a567-0e02b2c3d479',
      firm_id: DEFAULT_FIRM_ID,
      email: 'm.ross@slf.law',
      full_name: 'Marcus Ross',
      role: 'ASSOCIATE',
      initials: 'MR'
    },
    {
      id: 'u103ac10b-58cc-4372-a567-0e02b2c3d479',
      firm_id: DEFAULT_FIRM_ID,
      email: 'p.nair@slf.law',
      full_name: 'Priya Nair',
      role: 'ASSOCIATE',
      initials: 'PN'
    }
  ],
  storage_quotas: {
    [DEFAULT_FIRM_ID]: {
      storage_limit_bytes: 107374182400, // 100 GB
      storage_used_bytes: 34359738368,  // 32 GB
    }
  },
  folders: [
    { id: 'fld-root-1', firm_id: DEFAULT_FIRM_ID, parent_id: null, folder_name: 'Case Files', category: 'Case Files' },
    { id: 'fld-root-2', firm_id: DEFAULT_FIRM_ID, parent_id: null, folder_name: 'Practice Templates', category: 'Practice Templates' },
    { id: 'fld-root-3', firm_id: DEFAULT_FIRM_ID, parent_id: null, folder_name: 'Secure Shared', category: 'Secure Shared' },
    { id: 'fld-root-4', firm_id: DEFAULT_FIRM_ID, parent_id: null, folder_name: 'Archived', category: 'Archived' },
    { id: 'fld-sub-1', firm_id: DEFAULT_FIRM_ID, parent_id: 'fld-root-1', folder_name: 'Active Cases', category: 'Case Files' },
    { id: 'fld-sub-2', firm_id: DEFAULT_FIRM_ID, parent_id: 'fld-root-1', folder_name: 'Closed Cases', category: 'Case Files' }
  ],
  tags: [
    { id: 'tag-1', firm_id: DEFAULT_FIRM_ID, name: 'CONFIDENTIAL', color_code: '#E74C3C' },
    { id: 'tag-2', firm_id: DEFAULT_FIRM_ID, name: 'COURT FILING', color_code: '#C9A84C' },
    { id: 'tag-3', firm_id: DEFAULT_FIRM_ID, name: 'EVIDENCE', color_code: '#3B82F6' },
    { id: 'tag-4', firm_id: DEFAULT_FIRM_ID, name: 'RETAINER', color_code: '#2DC8B0' },
    { id: 'tag-5', firm_id: DEFAULT_FIRM_ID, name: 'DISCOVERY', color_code: '#9B59B6' }
  ],
  documents: [
    {
      id: 'doc-101',
      firm_id: DEFAULT_FIRM_ID,
      file_name: 'Anderson_Complaint_v1.pdf',
      original_name: 'Anderson_Complaint_v1.pdf',
      file_type: 'application/pdf',
      extension: 'pdf',
      file_size_bytes: 4718592, // 4.5 MB
      storage_path_url: '/storage/docs/Anderson_Complaint_v1.pdf',
      case_id: 'LC-2026-001',
      folder_id: 'fld-sub-1',
      author_id: DEFAULT_USER_ID,
      author_name: 'Sarah Jennings',
      author_initials: 'SJ',
      case_name: 'Anderson v. Meridian Corp.',
      category: 'Case Files',
      is_archived: false,
      is_flagged: true,
      is_deleted: false,
      tags: ['CONFIDENTIAL', 'COURT FILING'],
      updated_at: new Date('2026-07-22T14:30:00Z').toISOString(),
      created_at: new Date('2026-07-20T10:15:00Z').toISOString()
    },
    {
      id: 'doc-102',
      firm_id: DEFAULT_FIRM_ID,
      file_name: 'Davies_Defense_Affidavit.docx',
      original_name: 'Davies_Defense_Affidavit.docx',
      file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
      file_size_bytes: 2936012, // 2.8 MB
      storage_path_url: '/storage/docs/Davies_Defense_Affidavit.docx',
      case_id: 'LC-2026-002',
      folder_id: 'fld-sub-1',
      author_id: 'u102ac10b-58cc-4372-a567-0e02b2c3d479',
      author_name: 'Marcus Ross',
      author_initials: 'MR',
      case_name: 'Davies v. State',
      category: 'Case Files',
      is_archived: false,
      is_flagged: false,
      is_deleted: false,
      tags: ['EVIDENCE'],
      updated_at: new Date('2026-07-21T09:12:00Z').toISOString(),
      created_at: new Date('2026-07-19T11:00:00Z').toISOString()
    },
    {
      id: 'doc-103',
      firm_id: DEFAULT_FIRM_ID,
      file_name: 'Garrison_Trust_Agreement.pdf',
      original_name: 'Garrison_Trust_Agreement.pdf',
      file_type: 'application/pdf',
      extension: 'pdf',
      file_size_bytes: 12582912, // 12 MB
      storage_path_url: '/storage/docs/Garrison_Trust_Agreement.pdf',
      case_id: 'LC-2026-004',
      folder_id: 'fld-sub-1',
      author_id: 'u103ac10b-58cc-4372-a567-0e02b2c3d479',
      author_name: 'Priya Nair',
      author_initials: 'PN',
      case_name: 'Garrison Estate Management',
      category: 'Case Files',
      is_archived: false,
      is_flagged: true,
      is_deleted: false,
      tags: ['CONFIDENTIAL', 'RETAINER'],
      updated_at: new Date('2026-07-23T11:45:00Z').toISOString(),
      created_at: new Date('2026-07-23T08:30:00Z').toISOString()
    },
    {
      id: 'doc-104',
      firm_id: DEFAULT_FIRM_ID,
      file_name: 'Standard_Retainer_Agreement_2026.docx',
      original_name: 'Standard_Retainer_Agreement_2026.docx',
      file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
      file_size_bytes: 1572864, // 1.5 MB
      storage_path_url: '/storage/docs/Standard_Retainer_Agreement_2026.docx',
      case_id: null,
      folder_id: 'fld-root-2',
      author_id: DEFAULT_USER_ID,
      author_name: 'Sarah Jennings',
      author_initials: 'SJ',
      case_name: 'Firm Practice Template',
      category: 'Practice Templates',
      is_archived: false,
      is_flagged: false,
      is_deleted: false,
      tags: ['RETAINER'],
      updated_at: new Date('2026-06-15T16:00:00Z').toISOString(),
      created_at: new Date('2026-01-10T09:00:00Z').toISOString()
    },
    {
      id: 'doc-105',
      firm_id: DEFAULT_FIRM_ID,
      file_name: 'Blake_IP_Prior_Art_Audit.xlsx',
      original_name: 'Blake_IP_Prior_Art_Audit.xlsx',
      file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
      file_size_bytes: 8388608, // 8 MB
      storage_path_url: '/storage/docs/Blake_IP_Prior_Art_Audit.xlsx',
      case_id: 'LC-2026-005',
      folder_id: 'fld-sub-1',
      author_id: 'u102ac10b-58cc-4372-a567-0e02b2c3d479',
      author_name: 'Marcus Ross',
      author_initials: 'MR',
      case_name: 'Blake IP Dispute',
      category: 'Case Files',
      is_archived: false,
      is_flagged: false,
      is_deleted: false,
      tags: ['DISCOVERY'],
      updated_at: new Date('2026-07-22T17:20:00Z').toISOString(),
      created_at: new Date('2026-07-21T13:00:00Z').toISOString()
    }
  ],
  shares: [],
  audit_logs: [],
  client_messages: [
    {
      id: 'msg-1',
      client_name: 'James Anderson',
      client_avatar: 'JA',
      subject: 'Updated Financial Audit Evidence Attachment',
      preview: 'Attached is the revised corporate audit statement requested for the preliminary hearing. Please review ASAP.',
      timestamp_text: '10:42 AM Today',
      is_unread: true,
      is_urgent: true,
      attachment_name: 'Meridian_Financial_Audit_2025.pdf',
      attachment_size: '4.2 MB',
      attachment_doc_id: 'doc-101'
    },
    {
      id: 'msg-2',
      client_name: 'Chloe Garrison',
      client_avatar: 'CG',
      subject: 'Garrison Estate Deed Documentation',
      preview: 'Found the original property deeds from 1994. I have scanned and uploaded them into the vault.',
      timestamp_text: 'Yesterday, 4:15 PM',
      is_unread: true,
      is_urgent: false,
      attachment_name: 'Property_Deeds_1994_Scanned.pdf',
      attachment_size: '12.8 MB',
      attachment_doc_id: 'doc-103'
    }
  ],
  case_deadlines: [
    {
      id: 'dl-1',
      case_id: 'LC-2026-001',
      title: 'Anderson v. Meridian Motion Hearing',
      location: 'Courtroom 4B, Superior District Court',
      deadline_date: '2026-07-31',
      time_text: '09:30 AM',
      badge_type: 'Hearing',
      badge_color: '#C9A84C'
    },
    {
      id: 'dl-2',
      case_id: 'LC-2026-002',
      title: 'Davies Pre-trial Evidence Filing Deadline',
      location: 'County Clerk Portal',
      deadline_date: '2026-07-25',
      time_text: '05:00 PM',
      badge_type: 'Filing',
      badge_color: '#E74C3C'
    },
    {
      id: 'dl-3',
      case_id: 'LC-2026-005',
      title: 'Blake IP Discovery Conference',
      location: 'Virtual Conference Rm 2',
      deadline_date: '2026-07-28',
      time_text: '02:00 PM',
      badge_type: 'Discovery',
      badge_color: '#3B82F6'
    }
  ]
};

module.exports = {
  pool,
  DEFAULT_FIRM_ID,
  DEFAULT_USER_ID,
  inMemoryDb
};
