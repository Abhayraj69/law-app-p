/**
 * Copilot Tool Schemas (Zod)
 *
 * Defines input/output validation for all AI Copilot tools.
 * - READ-ONLY tools: searchVault, summarizeDocument (auto-execute)
 * - MUTATIVE tools: manageFiles, createOrUpdateCase (HITL-gated)
 */

const z = require('zod');

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
// ════════════════════════════════════════════════════════════════════════════
const ClientUpdatePayload = z.object({
  subject: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
  urgent: z.boolean().default(false),
}).optional();

const CreateOrUpdateCasePayload = z.object({
  status: z.string().max(50).optional(),
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
      displayName: 'Update Case',
      description: 'Update case status, assign attorney, post client update (requires approval)',
      category: 'mutative',
      hitl: true,
    },
  },
};