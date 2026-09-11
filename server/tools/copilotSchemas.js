/**
 * Copilot Tool Schemas (Zod)
 *
 * Defines input/output validation for all AI Copilot tools.
 * - READ-ONLY tools: searchVault, summarizeDocument (auto-execute)
 * - MUTATIVE tools: manageFiles, createOrUpdateCase (HITL-gated)
 */

const z = require('zod');
const CaseService = require('../services/caseService');

// ════════════════════════════════════════════════════════════════════════════
// 1. SEARCH VAULT — READ-ONLY
// ════════════════════════════════════════════════════════════════════════════
const SearchVaultInput = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(500, 'Query too long'),
  scope: z.enum(['all', 'documents', 'folders', 'cases', 'messages']).default('all'),
  limit: z.number().int().min(1).max(100).default(10),
});

const SearchResultItem = z.object({
  type: z.enum(['document', 'folder', 'case', 'message']),
  score: z.number().int().min(0),
  id: z.string(),
  title: z.string(),
  meta: z.string(),
  snippet: z.string(),
});

const SearchVaultOutput = z.object({
  success: z.literal(true),
  data: z.object({
    results: z.array(SearchResultItem),
    total: z.number().int().min(0),
    query: z.string(),
    scope: z.string(),
  }),
});

const SearchVaultError = z.object({
  success: z.literal(false),
  error: z.string(),
});

// ════════════════════════════════════════════════════════════════════════════
// 2. SUMMARIZE DOCUMENT — READ-ONLY
// ════════════════════════════════════════════════════════════════════════════
const SummarizeDocumentInput = z.object({
  document_id: z.string().min(1, 'Document ID is required'),
});

const SummaryKeyPoints = z.array(z.string());

const SummarizeDocumentOutput = z.object({
  success: z.literal(true),
  data: z.object({
    document_id: z.string(),
    file_name: z.string(),
    file_type: z.string(),
    case_name: z.string().nullable(),
    author_name: z.string(),
    tags: z.array(z.string()),
    size_mb: z.string(),
    updated_at: z.string(),
    executive_summary: z.string(),
    key_points: SummaryKeyPoints,
  }),
});

const SummarizeDocumentError = z.object({
  success: z.literal(false),
  error: z.string(),
});

// ════════════════════════════════════════════════════════════════════════════
// 3. MANAGE FILES — MUTATIVE (HITL)
// ════════════════════════════════════════════════════════════════════════════
const ManageFilesAction = z.enum(['move', 'rename', 'tag', 'delete']);
const ManageFilesTargetType = z.enum(['file', 'folder']);

const MovePayload = z.object({
  folder_id: z.string().min(1, 'Destination folder ID is required'),
});

const RenamePayload = z.object({
  new_name: z.string().min(1, 'New name cannot be empty').max(255, 'Name too long'),
});

const TagPayload = z.object({
  add_tags: z.array(z.string()).default([]),
  remove_tags: z.array(z.string()).default([]),
});

const DeletePayload = z.object({
  permanent: z.boolean().default(false),
});

const ManageFilesPayload = z.union([MovePayload, RenamePayload, TagPayload, DeletePayload]);

const ManageFilesInput = z.object({
  action: ManageFilesAction,
  target_id: z.string().min(1, 'Target ID is required'),
  target_type: ManageFilesTargetType.default('file'),
  payload: ManageFilesPayload,
  approved: z.boolean().default(false),
  executable_payload: ManageFilesPayload.optional(),
});

// Proposal payload returned for HITL approval
const FileProposal = z.object({
  // Action-specific fields populated by controller
  from: z.string().optional(),
  to: z.string().optional(),
  destination_name: z.string().optional(),
  old_name: z.string().optional(),
  new_name: z.string().optional(),
  current_tags: z.array(z.string()).optional(),
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
  target: z.string().optional(),
  permanent: z.boolean().optional(),
});

const ManageFilesApprovalData = z.object({
  tool: z.literal('manageFiles'),
  action: ManageFilesAction,
  target_id: z.string(),
  target_type: ManageFilesTargetType,
  target_name: z.string(),
  proposed_payload: FileProposal,
  executable_payload: ManageFilesPayload.optional(),
  message: z.string(),
});

const ManageFilesResult = z.object({
  moved_to: z.string().optional(),
  renamed_to: z.string().optional(),
  tags: z.array(z.string()).optional(),
  deleted: z.boolean().optional(),
});

const ManageFilesOutput = z.object({
  success: z.literal(true),
  requires_approval: z.boolean(),
  data: z.union([
    ManageFilesApprovalData,
    z.object({
      tool: z.literal('manageFiles'),
      action: ManageFilesAction,
      target_name: z.string(),
      result: ManageFilesResult,
    }),
  ]),
});

const ManageFilesError = z.object({
  success: z.literal(false),
  error: z.string(),
});

// ════════════════════════════════════════════════════════════════════════════
// 4. CREATE OR UPDATE CASE — MUTATIVE (HITL)
//
// `case_id` is a RESOLUTION HINT, not a guaranteed real primary key: the
// tool tries an exact id match first, falls back to an exact case_name
// match, and only creates a new case (with a freshly minted id — never
// the caller's case_id string literally) if neither resolves AND the
// payload carries enough information to create one (case_name +
// client_name). See server/services/caseService.js's resolveAndApply.
//
// `status` is a strict enum now, not a freeform string — this payload
// writes to the real `cases.status` column (server/services/
// caseService.js's VALID_STATUSES), which the rest of the app's UI reads
// directly (status pills/badges, dashboard active-case count); an
// arbitrary AI-generated string there would silently break rendering
// rather than fail loudly at the API boundary the way this schema does.
// ════════════════════════════════════════════════════════════════════════════
// .nullish() (not just .optional()) because both the controller's
// proposal payload AND a caller's own request body legitimately send an
// explicit `client_update: null` for "no client update this time", not
// only an omitted key — a pre-existing bug (present before this session,
// not introduced by it) had this as .optional() only, which made every
// createOrUpdateCase call THAT DIDN'T include a client update fail Zod
// validation on the controller's own output the moment it was actually
// exercised end-to-end.
const ClientUpdatePayload = z.object({
  subject: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
  urgent: z.boolean().default(false),
}).nullish();

// Single source of truth: server/services/caseService.js's VALID_STATUSES
// (z.enum needs at least one value, hence the fallback — CaseService
// always sets this, but it guards against an import-order accident).
const CASE_STATUS_VALUES = CaseService.VALID_STATUSES && CaseService.VALID_STATUSES.length
  ? CaseService.VALID_STATUSES
  : ['active', 'pending', 'urgent', 'closed'];

const CreateOrUpdateCasePayload = z.object({
  // Only meaningful (and required together) when no existing case
  // resolves — see the tool-level comment above.
  case_name: z.string().min(1).max(255).optional(),
  client_name: z.string().min(1).max(255).optional(),
  opposing_party: z.string().max(255).optional(),
  opposing_counsel: z.string().max(255).optional(),
  case_type: z.string().max(100).optional(),
  status: z.enum(CASE_STATUS_VALUES).optional(),
  lead_attorney: z.string().max(100).optional(),
  client_update: ClientUpdatePayload,
});

const CreateOrUpdateCaseInput = z.object({
  case_id: z.string().min(1, 'Case ID is required'),
  payload: CreateOrUpdateCasePayload.default({}),
  approved: z.boolean().default(false),
  executable_payload: CreateOrUpdateCasePayload.optional(),
});

const CaseProposal = z.object({
  case_id: z.string(),
  action: z.enum(['create', 'update']),
  matched_by: z.enum(['id', 'name']).nullable(),
  status: z.string().optional(),
  lead_attorney: z.string().optional(),
  client_update: ClientUpdatePayload,
});

const CreateOrUpdateCaseApprovalData = z.object({
  tool: z.literal('createOrUpdateCase'),
  case_id: z.string(),
  case_name: z.string(),
  proposed_payload: CaseProposal,
  executable_payload: CreateOrUpdateCasePayload.optional(),
  message: z.string(),
});

const CaseUpdateResult = z.object({
  case_id: z.string(),
  action: z.enum(['create', 'update']),
  matched_by: z.enum(['id', 'name']).nullable(),
  applied: z.array(z.string()),
});

const CreateOrUpdateCaseOutput = z.object({
  success: z.literal(true),
  requires_approval: z.boolean(),
  data: z.union([
    CreateOrUpdateCaseApprovalData,
    z.object({
      tool: z.literal('createOrUpdateCase'),
      case_id: z.string(),
      result: CaseUpdateResult,
    }),
  ]),
});

const CreateOrUpdateCaseError = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
});

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════
module.exports = {
  // Input schemas
  SearchVaultInput,
  SummarizeDocumentInput,
  ManageFilesInput,
  CreateOrUpdateCaseInput,

  // Output schemas
  SearchVaultOutput,
  SearchVaultError,
  SummarizeDocumentOutput,
  SummarizeDocumentError,
  ManageFilesOutput,
  ManageFilesError,
  CreateOrUpdateCaseOutput,
  CreateOrUpdateCaseError,

  // HITL approval types
  ManageFilesApprovalData,
  CreateOrUpdateCaseApprovalData,
  FileProposal,
  CaseProposal,

  // Convenience: all input schemas in an object for validation middleware
  ToolInputs: {
    searchVault: SearchVaultInput,
    summarizeDocument: SummarizeDocumentInput,
    manageFiles: ManageFilesInput,
    createOrUpdateCase: CreateOrUpdateCaseInput,
  },

  // Tool metadata for UI rendering
  ToolMetadata: {
    searchVault: {
      name: 'searchVault',
      displayName: 'Search Vault',
      description: 'Semantic search across documents, folders, cases, and messages',
      category: 'read-only',
      hitl: false,
    },
    summarizeDocument: {
      name: 'summarizeDocument',
      displayName: 'Summarize Document',
      description: 'Generate executive summary and key points from a document',
      category: 'read-only',
      hitl: false,
    },
    manageFiles: {
      name: 'manageFiles',
      displayName: 'Manage Files',
      description: 'Move, rename, tag, or delete files and folders (requires approval)',
      category: 'mutative',
      hitl: true,
      actions: ['move', 'rename', 'tag', 'delete'],
    },
    createOrUpdateCase: {
      name: 'createOrUpdateCase',
      displayName: 'Create or Update Case',
      description: 'Update an existing case\'s status/attorney/opposing-party details, or create a new one if case_id ' +
        'doesn\'t match any real case AND case_name + client_name are both provided (requires approval). ' +
        'case_id is a resolution hint, not a guaranteed literal id: an exact match against a real case wins; ' +
        'otherwise an exact case_name match is tried; a new case (with a freshly assigned id) is only created if ' +
        'neither resolves. status must be one of: active, pending, urgent, closed.',
      category: 'mutative',
      hitl: true,
    },
  },
};