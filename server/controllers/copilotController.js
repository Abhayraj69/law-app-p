/**
 * AI Copilot Controller
 *
 * Exposes autonomous app-control tools with mandatory Human-in-the-Loop (HITL)
 * authorization for write/mutative actions.
 *
 *  - READ-ONLY tools (searchVault, summarizeDocument) execute automatically.
 *  - WRITE tools (manageFiles, createOrUpdateCase) return a pending "approval"
 *    payload that the frontend must present to the user. The action is only
 *    committed when the client re-calls with { approved: true }.
 */

const { inMemoryDb, DEFAULT_FIRM_ID } = require('../db');
const aiProvider = require('../services/aiProvider');
const {
  ToolInputs,
  SearchVaultOutput,
  SearchVaultError,
  SummarizeDocumentOutput,
  SummarizeDocumentError,
  ManageFilesOutput,
  ManageFilesError,
  CreateOrUpdateCaseOutput,
  CreateOrUpdateCaseError,
  ManageFilesApprovalData,
  CreateOrUpdateCaseApprovalData,
} = require('../tools/copilotSchemas');

// ── In-memory "cases" derivation ────────────────────────────────────────────
// The dataset has no cases table; cases are inferred from documents + deadlines.
function getCases(firmId) {
  const cases = {};
  inMemoryDb.documents
    .filter(d => d.firm_id === firmId && !d.is_deleted)
    .forEach(d => {
      if (!d.case_id) return;
      if (!cases[d.case_id]) {
        cases[d.case_id] = {
          case_id: d.case_id,
          case_name: d.case_name,
          status: 'ACTIVE',
          lead_attorney: d.author_name,
          document_count: 0,
          updated_at: d.updated_at
        };
      }
      cases[d.case_id].document_count++;
      if (new Date(d.updated_at) > new Date(cases[d.case_id].updated_at)) {
        cases[d.case_id].updated_at = d.updated_at;
      }
    });
  return Object.values(cases);
}

// ── Simple token-overlap semantic search ─────────────────────────────────────
function scoreMatch(haystack, terms) {
  const h = haystack.toLowerCase();
  return terms.reduce((score, t) => (h.includes(t) ? score + 1 : score), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION MIDDLEWARE
// ════════════════════════════════════════════════════════════════════════════
function validateToolInput(toolName) {
  return (req, res, next) => {
    const schema = ToolInputs[toolName];
    if (!schema) {
      return next(); // No schema defined, skip validation
    }

    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return res.status(400).json({ success: false, error: `Validation failed: ${errors}` });
    }

    // Replace body with validated/coerced data
    req.body = result.data;
    next();
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. searchVault — READ-ONLY (autonomous)
// ════════════════════════════════════════════════════════════════════════════
async function searchVault(req, res, next) {
  try {
    const { query = '', scope = 'all', limit = 10 } = req.body;
    const firmId = req.tenantId;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    if (!terms.length) {
      return res.json(SearchVaultOutput.parse({
        success: true,
        data: { results: [], total: 0, query, scope }
      }));
    }

    const results = [];

    if (scope === 'all' || scope === 'documents') {
      inMemoryDb.documents
        .filter(d => d.firm_id === firmId && !d.is_deleted)
        .forEach(d => {
          const text = `${d.file_name} ${d.case_name} ${d.author_name} ${(d.tags || []).join(' ')}`;
          const score = scoreMatch(text, terms);
          if (score > 0) results.push({ type: 'document', score, id: d.id, title: d.file_name, meta: d.case_name, snippet: text.slice(0, 120) });
        });
    }

    if (scope === 'all' || scope === 'folders') {
      inMemoryDb.folders
        .filter(f => f.firm_id === firmId)
        .forEach(f => {
          const score = scoreMatch(f.folder_name, terms);
          if (score > 0) results.push({ type: 'folder', score, id: f.id, title: f.folder_name, meta: f.category, snippet: f.folder_name });
        });
    }

    if (scope === 'all' || scope === 'cases') {
      getCases(firmId).forEach(c => {
        const score = scoreMatch(`${c.case_name} ${c.case_id} ${c.lead_attorney}`, terms);
        if (score > 0) results.push({ type: 'case', score, id: c.case_id, title: c.case_name, meta: c.case_id, snippet: `${c.case_name} — ${c.status}` });
      });
    }

    if (scope === 'all' || scope === 'messages') {
      (inMemoryDb.client_messages || [])
        .forEach(m => {
          const score = scoreMatch(`${m.client_name} ${m.subject} ${m.preview}`, terms);
          if (score > 0) results.push({ type: 'message', score, id: m.id, title: m.subject, meta: m.client_name, snippet: m.preview });
        });
    }

    results.sort((a, b) => b.score - a.score);
    const slice = results.slice(0, limit);

    res.json(SearchVaultOutput.parse({
      success: true,
      data: { results: slice, total: results.length, query, scope }
    }));
  } catch (err) {
    next(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. summarizeDocument — READ-ONLY (autonomous)
// ════════════════════════════════════════════════════════════════════════════
async function summarizeDocument(req, res, next) {
  try {
    const { document_id } = req.body;
    const firmId = req.tenantId;
    const doc = inMemoryDb.documents.find(d => d.id === document_id && d.firm_id === firmId);

    if (!doc) {
      return res.status(404).json(SummarizeDocumentError.parse({
        success: false,
        error: 'Document not found'
      }));
    }

    // Check if AI provider is configured for enhanced summarization
    let summary;
    if (aiProvider.isConfigured()) {
      // Use AI-enhanced summarization
      summary = await generateAiSummary(doc);
    } else {
      // Fallback to metadata-based summary
      summary = buildMetadataSummary(doc);
    }

    res.json(SummarizeDocumentOutput.parse({
      success: true,
      data: summary
    }));
  } catch (err) {
    next(err);
  }
}

function buildMetadataSummary(doc) {
  const date = new Date(doc.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return {
    document_id: doc.id,
    file_name: doc.file_name,
    file_type: doc.extension,
    case_name: doc.case_name || null,
    author_name: doc.author_name,
    tags: doc.tags || [],
    size_mb: (doc.file_size_bytes / (1024 * 1024)).toFixed(1),
    updated_at: doc.updated_at,
    executive_summary: `${doc.file_name} is a ${doc.extension.toUpperCase()} document authored by ${doc.author_name} ` +
      `on the ${doc.case_name || 'firm'} matter, last updated ${date}. ` +
      `It carries ${doc.tags && doc.tags.length ? doc.tags.join(', ') + ' flags' : 'no special classifications'} ` +
      `and spans ${(doc.file_size_bytes / (1024 * 1024)).toFixed(1)} MB of content. ` +
      `Recommended action: ${doc.is_flagged ? 'route for partner review before distribution.' : 'available for standard circulation.'}`,
    key_points: [
      `Owned by ${doc.author_name} (${doc.author_initials || '—'})`,
      doc.case_name ? `Linked case: ${doc.case_name} (${doc.case_id || 'n/a'})` : 'No linked case',
      `Classification: ${(doc.tags || []).join(', ') || 'Unclassified'}`,
      doc.is_flagged ? 'Flagged for review — requires sign-off' : 'Cleared for standard use'
    ]
  };
}

async function generateAiSummary(doc) {
  try {
    const prompt = `You are a legal AI assistant. Summarize this document based on its metadata.

Document: ${doc.file_name}
Type: ${doc.extension.toUpperCase()}
Case: ${doc.case_name || 'N/A'}
Author: ${doc.author_name}
Size: ${(doc.file_size_bytes / (1024 * 1024)).toFixed(1)} MB
Tags: ${(doc.tags || []).join(', ') || 'None'}
Flagged: ${doc.is_flagged ? 'Yes' : 'No'}
Last Updated: ${new Date(doc.updated_at).toLocaleDateString()}

Provide:
1. A concise executive summary (2-3 sentences)
2. 4-5 key points as bullet points

Return ONLY a JSON object with keys: executive_summary, key_points (array of strings).`;

    const response = await aiProvider.chatCompletion([
      { role: 'system', content: 'You are a legal document summarizer. Output only valid JSON.' },
      { role: 'user', content: prompt }
    ], { temperature: 0.1, maxTokens: 1000 });

    // Parse AI response
    let aiData;
    try {
      aiData = JSON.parse(response);
    } catch {
      // Fallback if AI returns malformed JSON
      return buildMetadataSummary(doc);
    }

    return {
      document_id: doc.id,
      file_name: doc.file_name,
      file_type: doc.extension,
      case_name: doc.case_name || null,
      author_name: doc.author_name,
      tags: doc.tags || [],
      size_mb: (doc.file_size_bytes / (1024 * 1024)).toFixed(1),
      updated_at: doc.updated_at,
      executive_summary: aiData.executive_summary || buildMetadataSummary(doc).executive_summary,
      key_points: Array.isArray(aiData.key_points) ? aiData.key_points : buildMetadataSummary(doc).key_points
    };
  } catch (err) {
    console.error('[Copilot] AI summarization failed, using fallback:', err.message);
    return buildMetadataSummary(doc);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. manageFiles — WRITE (HITL-gated)
//    action: move | rename | tag | delete
// ════════════════════════════════════════════════════════════════════════════
async function manageFiles(req, res, next) {
  try {
    const { action, target_id, target_type = 'file', payload = {}, approved = false, executable_payload } = req.body;
    const firmId = req.tenantId;

    const allowed = ['move', 'rename', 'tag', 'delete'];
    if (!allowed.includes(action)) {
      return res.status(400).json(ManageFilesError.parse({
        success: false,
        error: `Unsupported action: ${action}`
      }));
    }

    const target = target_type === 'folder'
      ? inMemoryDb.folders.find(f => f.id === target_id && f.firm_id === firmId)
      : inMemoryDb.documents.find(d => d.id === target_id && d.firm_id === firmId);

    if (!target) {
      return res.status(404).json(ManageFilesError.parse({
        success: false,
        error: 'Target not found'
      }));
    }

    const label = target.file_name || target.folder_name;

    // Build the proposed payload for the Approval Card
    const proposed = buildFileProposal(action, target, payload);

    // HITL: if not yet approved, return the pending approval — do NOT mutate.
    if (!approved) {
      return res.json(ManageFilesOutput.parse({
        success: true,
        requires_approval: true,
        data: {
          tool: 'manageFiles',
          action,
          target_id,
          target_type,
          target_name: label,
          proposed_payload: proposed,
          executable_payload: executable_payload || payload,
          message: `Approve ${action} on "${label}"?`
        }
      }));
    }

    // Approved — commit the mutation
    // Use executable_payload if provided (from approval confirm), else use payload
    const commitPayload = executable_payload || payload;
    const result = commitFileAction(action, target, commitPayload);

    // Log audit trail
    logAuditTrail(req, action, target_id, target_type, commitPayload);

    res.json(ManageFilesOutput.parse({
      success: true,
      requires_approval: false,
      data: { tool: 'manageFiles', action, target_name: label, result }
    }));
  } catch (err) {
    next(err);
  }
}

function buildFileProposal(action, target, payload) {
  switch (action) {
    case 'move': {
      const dest = inMemoryDb.folders.find(f => f.id === payload.folder_id);
      return { from: target.folder_id || 'root', to: payload.folder_id, destination_name: dest ? dest.folder_name : payload.folder_id };
    }
    case 'rename':
      return { old_name: target.file_name || target.folder_name, new_name: payload.new_name };
    case 'tag':
      return { current_tags: target.tags || [], add: payload.add_tags || [], remove: payload.remove_tags || [] };
    case 'delete':
      return { target: target.file_name || target.folder_name, permanent: !!payload.permanent };
    default:
      return payload;
  }
}

function commitFileAction(action, target, payload) {
  switch (action) {
    case 'move':
      target.folder_id = payload.folder_id;
      target.updated_at = new Date().toISOString();
      return { moved_to: payload.folder_id };
    case 'rename':
      if (target.file_name !== undefined) target.file_name = payload.new_name;
      if (target.folder_name !== undefined) target.folder_name = payload.new_name;
      target.updated_at = new Date().toISOString();
      return { renamed_to: payload.new_name };
    case 'tag': {
      const tags = new Set(target.tags || []);
      (payload.add_tags || []).forEach(t => tags.add(t));
      (payload.remove_tags || []).forEach(t => tags.delete(t));
      target.tags = Array.from(tags);
      target.updated_at = new Date().toISOString();
      return { tags: Array.from(tags) };
    }
    case 'delete':
      if (target.is_deleted !== undefined) {
        target.is_deleted = true;
        target.updated_at = new Date().toISOString();
      } else {
        const idx = inMemoryDb.folders.indexOf(target);
        if (idx > -1) inMemoryDb.folders.splice(idx, 1);
      }
      return { deleted: true };
    default:
      return {};
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4. createOrUpdateCase — WRITE (HITL-gated)
//    Updates case status, assigns attorneys, posts client updates.
// ════════════════════════════════════════════════════════════════════════════
async function createOrUpdateCase(req, res, next) {
  try {
    const { case_id, payload = {}, approved = false, executable_payload } = req.body;
    const firmId = req.tenantId;

    const cases = getCases(firmId);
    const existing = cases.find(c => c.case_id === case_id);

    const proposed = {
      case_id,
      status: payload.status || existing?.status,
      lead_attorney: payload.lead_attorney || existing?.lead_attorney,
      client_update: payload.client_update || null
    };

    if (!approved) {
      return res.json(CreateOrUpdateCaseOutput.parse({
        success: true,
        requires_approval: true,
        data: {
          tool: 'createOrUpdateCase',
          case_id,
          case_name: existing?.case_name || case_id,
          proposed_payload: proposed,
          executable_payload: executable_payload || payload,
          message: `Approve update to case "${existing?.case_name || case_id}"?`
        }
      }));
    }

    // Commit — use executable_payload if provided (from approval confirm), else payload
    const commitPayload = executable_payload || payload;
    const result = { case_id, applied: [] };
    if (commitPayload.status) result.applied.push(`status → ${commitPayload.status}`);
    if (commitPayload.lead_attorney) result.applied.push(`lead attorney → ${commitPayload.lead_attorney}`);
    if (commitPayload.client_update) {
      if (!inMemoryDb.client_messages) inMemoryDb.client_messages = [];
      inMemoryDb.client_messages.unshift({
        id: `msg-${Date.now()}`,
        client_name: existing?.case_name || case_id,
        client_avatar: (existing?.case_name || case_id).slice(0, 2).toUpperCase(),
        subject: commitPayload.client_update.subject || 'Case Update',
        preview: commitPayload.client_update.body || '',
        timestamp_text: 'Just now',
        is_unread: true,
        is_urgent: !!commitPayload.client_update.urgent,
        attachment_name: null,
        attachment_size: null,
        attachment_doc_id: null
      });
      result.applied.push('posted client update');
    }

    // Log audit trail
    logAuditTrail(req, 'update_case', case_id, 'case', commitPayload);

    res.json(CreateOrUpdateCaseOutput.parse({
      success: true,
      requires_approval: false,
      data: { tool: 'createOrUpdateCase', case_id, result }
    }));
  } catch (err) {
    next(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AUDIT LOGGING HELPER
// ════════════════════════════════════════════════════════════════════════════
function logAuditTrail(req, action, targetId, targetType, details) {
  const auditRecord = {
    id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    firm_id: req.tenantId || DEFAULT_FIRM_ID,
    user_id: req.user?.id || 'u101ac10b-58cc-4372-a567-0e02b2c3d479',
    user_name: req.user?.full_name || 'Sarah Jennings',
    document_id: targetType === 'file' ? targetId : null,
    folder_id: targetType === 'folder' ? targetId : null,
    case_id: targetType === 'case' ? targetId : null,
    action: `COPILOT_${action.toUpperCase()}`,
    ip_address: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
    user_agent: req.headers['user-agent'] || 'AI Copilot',
    details: { target_type: targetType, ...details },
    created_at: new Date().toISOString()
  };

  inMemoryDb.audit_logs.unshift(auditRecord);
  console.log(`[AUDIT LOG] Copilot Action: ${action} | User: ${auditRecord.user_name} | Target: ${targetId} (${targetType})`);
}

module.exports = {
  searchVault,
  summarizeDocument,
  manageFiles,
  createOrUpdateCase,
  validateToolInput,
};