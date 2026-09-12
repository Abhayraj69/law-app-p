/**
 * AI Copilot Controller
 *
 * Exposes autonomous app-control tools with a mandatory Human-in-the-Loop
 * (HITL) confirmation step for write/mutative actions.
 *
 *  - READ-ONLY tools (searchVault, summarizeDocument) execute automatically.
 *  - WRITE tools (manageFiles, createOrUpdateCase) return a pending "approval"
 *    payload that the frontend must present to the user. The action is only
 *    committed when the client re-calls with { approved: true }.
 *
 * SECURITY NOTE — HITL `approved` is a UX gate, not an authorization control.
 * It only proves a human clicked "approve" in the Copilot UI; it says
 * nothing about whether that human is allowed to perform the action at all.
 * `approved: true` is a value the caller supplies in the request body, so
 * treating it as proof of authorization would let anyone self-certify their
 * own mutation. The actual authorization boundary is the role checks below
 * (hasMinRole / requireCaseChangeRole). manageFiles' delete floor mirrors
 * the requireRole() floor already enforced on the equivalent direct route
 * (DELETE /api/v1/files/:id -> ASSOCIATE, see server/routes/api.js).
 * createOrUpdateCase's floor for lead-attorney reassignment or closing a
 * case (PARTNER+) is deliberately stricter than any single direct route,
 * since no other route change reaches both of those at once — see
 * requireCaseChangeRole below for the exact rule. Both are applied
 * regardless of `approved`, so a caller can't reach a privileged mutation
 * just by skipping straight to the commit call with approved:true.
 */

const db = require('../db');
const aiProvider = require('../services/aiProvider');
const CaseService = require('../services/caseService');
const { ROLE_HIERARCHY } = require('../middleware/auth');
const {
  ToolInputs,
  SearchVaultOutput,
  SummarizeDocumentOutput,
  SummarizeDocumentError,
  ManageFilesOutput,
  ManageFilesError,
  CreateOrUpdateCaseOutput,
  CreateOrUpdateCaseError,
} = require('../tools/copilotSchemas');

// ── Simple token-overlap semantic search ─────────────────────────────────────
function scoreMatch(haystack, terms) {
  const h = haystack.toLowerCase();
  return terms.reduce((score, t) => (h.includes(t) ? score + 1 : score), 0);
}

// ── Role gating for Copilot write tools ──────────────────────────────────────
// requireRole() in server/middleware/auth.js only works as route middleware,
// gating an entire route to one floor. manageFiles and createOrUpdateCase
// each share a single route across several actions/fields with different
// privilege requirements (manageFiles' delete vs. move/rename/tag;
// createOrUpdateCase's status/lead_attorney vs. opposing-party edits), so
// the equivalent check has to live in the handler and be applied per
// action/field rather than per route. Same ROLE_HIERARCHY, same semantics.
function hasMinRole(user, minRole) {
  const userLevel = ROLE_HIERARCHY[user && user.role] || 0;
  const requiredLevel = ROLE_HIERARCHY[minRole] || 99;
  return userLevel >= requiredLevel;
}

// Same wording requireRole() (server/middleware/auth.js) already returns
// for a route-level 403, so a role failure looks identical to the caller
// whether it came from a direct route or from one of these per-action
// checks inside a Copilot tool.
function roleErrorMessage(user, minRole) {
  return `Forbidden: Role '${user && user.role}' lacks sufficient privilege. Required: '${minRole}'.`;
}

function forbiddenError(user, minRole, detail) {
  const err = new Error(roleErrorMessage(user, minRole) + (detail ? ` (${detail})` : ''));
  err.status = 403;
  err.code = 'INSUFFICIENT_ROLE';
  return err;
}

// Lead-attorney reassignment and closing a case (the only terminal status
// — see VALID_STATUSES in caseService.js) are the two case changes with
// real seniority consequences: handing a matter to a different attorney,
// or ending it outright. Those require PARTNER or higher. Any other
// status transition (e.g. active -> pending -> urgent) keeps the lower
// ASSOCIATE floor it already had; opposing-party/case-type/description
// edits stay fully ungated, same as before — this function must never
// tighten those. Checked against whatever payload governs the call it's
// guarding (the proposal payload for the HITL preview, the executable
// payload for the commit) since the two can legitimately differ, and
// `approved: true` alone must never be enough to bypass this (see the
// SECURITY NOTE at the top of this file).
function requireCaseChangeRole(user, payload) {
  const changesAttorney = Object.prototype.hasOwnProperty.call(payload || {}, 'lead_attorney');
  const changesStatus = Object.prototype.hasOwnProperty.call(payload || {}, 'status');
  const closesCase = changesStatus && payload.status === 'closed';

  if (changesAttorney || closesCase) {
    if (hasMinRole(user, 'PARTNER')) return;
    const fields = [changesAttorney && 'lead_attorney', closesCase && 'status'].filter(Boolean).join(' and ');
    throw forbiddenError(user, 'PARTNER', `changing a case's ${fields}`);
  }

  if (changesStatus) {
    if (hasMinRole(user, 'ASSOCIATE')) return;
    throw forbiddenError(user, 'ASSOCIATE', `changing a case's status`);
  }
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
      const docs = await db.listActiveDocuments(firmId);
      docs.forEach(d => {
        const text = `${d.file_name} ${d.case_name} ${d.author_name} ${(d.tags || []).join(' ')}`;
        const score = scoreMatch(text, terms);
        if (score > 0) results.push({ type: 'document', score, id: d.id, title: d.file_name, meta: d.case_name, snippet: text.slice(0, 120) });
      });
    }

    if (scope === 'all' || scope === 'folders') {
      const folders = await db.listFolders(firmId);
      folders.forEach(f => {
        const score = scoreMatch(f.folder_name, terms);
        if (score > 0) results.push({ type: 'folder', score, id: f.id, title: f.folder_name, meta: f.category, snippet: f.folder_name });
      });
    }

    if (scope === 'all' || scope === 'cases') {
      // Real cases table (CaseService.listCases), same as the Active
      // Cases page and createOrUpdateCase's commit path — previously this
      // searched a pseudo-case view derived from documents.case_id, which
      // had no real status/attorney and could drift from what
      // createOrUpdateCase actually writes. Role-scoped by req.user, same
      // as everywhere else a case is read: a CLIENT caller must not be
      // able to search-discover another client's case through the
      // Copilot even though a direct fetch of it is already blocked.
      const cases = await CaseService.listCases(firmId, req.user);
      cases.forEach(c => {
        const score = scoreMatch(`${c.name} ${c.id} ${c.attorney || ''}`, terms);
        if (score > 0) results.push({ type: 'case', score, id: c.id, title: c.name, meta: c.id, snippet: `${c.name} — ${c.status}` });
      });
    }

    if (scope === 'all' || scope === 'messages') {
      const messages = await db.listClientMessages(firmId);
      messages.forEach(m => {
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
    const doc = await db.getDocumentById(firmId, document_id);

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
  const sizeMb = (Number(doc.file_size_bytes) / (1024 * 1024)).toFixed(1);
  return {
    document_id: doc.id,
    file_name: doc.file_name,
    file_type: doc.extension,
    case_name: doc.case_name || null,
    author_name: doc.author_name,
    tags: doc.tags || [],
    size_mb: sizeMb,
    updated_at: doc.updated_at,
    executive_summary: `${doc.file_name} is a ${doc.extension.toUpperCase()} document authored by ${doc.author_name} ` +
      `on the ${doc.case_name || 'firm'} matter, last updated ${date}. ` +
      `It carries ${doc.tags && doc.tags.length ? doc.tags.join(', ') + ' flags' : 'no special classifications'} ` +
      `and spans ${sizeMb} MB of content. ` +
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
    const sizeMb = (Number(doc.file_size_bytes) / (1024 * 1024)).toFixed(1);
    const prompt = `You are a legal AI assistant. Summarize this document based on its metadata.

Document: ${doc.file_name}
Type: ${doc.extension.toUpperCase()}
Case: ${doc.case_name || 'N/A'}
Author: ${doc.author_name}
Size: ${sizeMb} MB
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

    const fallback = buildMetadataSummary(doc);
    return {
      ...fallback,
      executive_summary: aiData.executive_summary || fallback.executive_summary,
      key_points: Array.isArray(aiData.key_points) ? aiData.key_points : fallback.key_points
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

    // Matches the requireRole('ASSOCIATE') floor already enforced on
    // DELETE /api/v1/files/:id (server/routes/api.js) — without this, a
    // PARALEGAL blocked from deleting a file via the Vault UI could still
    // delete it via the Copilot, since this route only requires
    // authMiddleware. Checked before touching the target and regardless of
    // `approved`, so it blocks both the HITL preview and the commit call.
    if (action === 'delete' && !hasMinRole(req.user, 'ASSOCIATE')) {
      return res.status(403).json(ManageFilesError.parse({
        success: false,
        error: roleErrorMessage(req.user, 'ASSOCIATE') + ' (deleting files/folders)'
      }));
    }

    const target = target_type === 'folder'
      ? await db.getFolderById(firmId, target_id)
      : await db.getDocumentById(firmId, target_id);

    if (!target) {
      return res.status(404).json(ManageFilesError.parse({
        success: false,
        error: 'Target not found'
      }));
    }

    const label = target.file_name || target.folder_name;

    // Build the proposed payload for the Approval Card
    const proposed = await buildFileProposal(firmId, action, target, payload);

    // HITL: if not yet approved, return the pending approval — do NOT mutate.
    // This is a UX confirmation step only (did a human click "approve"?),
    // not an authorization check — `approved` is caller-supplied and proves
    // nothing about privilege. The role check above already ran and applies
    // the same regardless of this flag.
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
    const result = await commitFileAction(firmId, action, target_type, target, commitPayload);

    // Log audit trail
    await logAuditTrail(req, action, target_id, target_type, commitPayload);

    res.json(ManageFilesOutput.parse({
      success: true,
      requires_approval: false,
      data: { tool: 'manageFiles', action, target_name: label, result }
    }));
  } catch (err) {
    next(err);
  }
}

async function buildFileProposal(firmId, action, target, payload) {
  switch (action) {
    case 'move': {
      const dest = await db.getFolderById(firmId, payload.folder_id);
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

async function commitFileAction(firmId, action, targetType, target, payload) {
  const isFolder = targetType === 'folder';
  switch (action) {
    case 'move':
      await db.updateDocument(firmId, target.id, { folder_id: payload.folder_id });
      return { moved_to: payload.folder_id };
    case 'rename':
      if (isFolder) {
        await db.updateFolder(firmId, target.id, { folder_name: payload.new_name });
      } else {
        await db.updateDocument(firmId, target.id, { file_name: payload.new_name });
      }
      return { renamed_to: payload.new_name };
    case 'tag': {
      if (isFolder) {
        return { tags: [] }; // folders don't carry tags in the current schema
      }
      const tags = new Set(target.tags || []);
      (payload.add_tags || []).forEach(t => tags.add(t));
      (payload.remove_tags || []).forEach(t => tags.delete(t));
      const tagList = Array.from(tags);
      await db.updateDocument(firmId, target.id, { tags: tagList });
      return { tags: tagList };
    }
    case 'delete':
      if (isFolder) {
        await db.deleteFolder(firmId, target.id);
      } else {
        await db.softDeleteDocument(firmId, target.id);
      }
      return { deleted: true };
    default:
      return {};
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4. createOrUpdateCase — WRITE (HITL-gated)
//    Updates an existing case's status/attorney/opposing-party details, or
//    creates a new one — for real, in the `cases` table — via
//    CaseService.resolveAndApply. `case_id` is a resolution hint, never a
//    guaranteed literal primary key: an exact id match wins; failing that,
//    an exact case_name match; a new case (freshly minted id) is created
//    only if neither resolves AND the payload has enough information to
//    (case_name + client_name) — see caseService.js for why, and for the
//    concurrent-create race handling.
// ════════════════════════════════════════════════════════════════════════════
async function createOrUpdateCase(req, res, next) {
  try {
    const { case_id, payload = {}, approved = false, executable_payload } = req.body;
    const firmId = req.tenantId;

    // No seniority floor previously existed here at all: any authenticated
    // caller could reassign a case's lead attorney or close it out through
    // the Copilot. Reassigning the attorney or closing the case now
    // requires PARTNER+; any other status change keeps the lower
    // ASSOCIATE+ floor — see requireCaseChangeRole above for the exact
    // rule. Checked against the proposal payload before any work happens,
    // so an under-privileged caller is refused even at the HITL preview
    // step.
    requireCaseChangeRole(req.user, payload);

    // Resolved once here (for the approval preview) and again inside
    // resolveAndApply at commit time — not because this result is
    // untrusted, but because state can legitimately change in the window
    // between a human seeing the proposal and clicking "approve" (someone
    // else could create/rename a matching case in the meantime), and the
    // human must never approve one plan and have a different one execute.
    let resolution;
    try {
      resolution = await CaseService.resolveCaseIdentity(firmId, { caseId: case_id, caseName: payload.case_name });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json(CreateOrUpdateCaseError.parse({ success: false, error: err.message, code: err.code }));
      }
      throw err;
    }

    const action = resolution.case ? 'update' : 'create';
    const resolvedCaseId = resolution.case ? resolution.case.id : case_id;
    const caseName = resolution.case ? resolution.case.name : payload.case_name;

    if (!approved) {
      if (action === 'create' && (!payload.case_name || !payload.client_name)) {
        // Fail the proposal clearly now, rather than showing an approval
        // prompt for a "create" the commit step could never actually do.
        const message = `No case matches "${case_id}"${payload.case_name ? ` or the name "${payload.case_name}"` : ''}, and there isn't enough information to create one — both case_name and client_name are required.`;
        return res.status(404).json(CreateOrUpdateCaseError.parse({ success: false, error: message, code: 'CASE_NOT_FOUND' }));
      }

      const message = action === 'create'
        ? `No existing case matches "${case_id}". Approve CREATING a new case "${payload.case_name}" for client "${payload.client_name}"?`
        : `Approve update to case "${caseName}" (${resolvedCaseId})${resolution.matchedBy === 'name' ? ` — matched by name, not id "${case_id}"` : ''}?`;

      return res.json(CreateOrUpdateCaseOutput.parse({
        success: true,
        requires_approval: true,
        data: {
          tool: 'createOrUpdateCase',
          case_id: resolvedCaseId,
          case_name: caseName || case_id,
          proposed_payload: {
            case_id: resolvedCaseId,
            action,
            matched_by: resolution.matchedBy,
            status: payload.status || resolution.case?.status,
            lead_attorney: payload.lead_attorney || resolution.case?.attorney,
            client_update: payload.client_update || null
          },
          executable_payload: executable_payload || payload,
          message
        }
      }));
    }

    // Commit — use executable_payload if provided (from approval confirm),
    // else payload. resolveAndApply does the real work: re-resolves
    // identity, validates status/attorney, writes to `cases` for real, and
    // logs its own audit entry (COPILOT_CREATE_CASE / COPILOT_UPDATE_CASE).
    const commitPayload = executable_payload || payload;

    // Re-checked against commitPayload, not just the proposal `payload`
    // above: executable_payload is client-supplied and can differ from
    // what was proposed, so a caller who lacked status/lead_attorney at
    // preview time must not be able to smuggle them in at commit time.
    // `approved: true` does not substitute for this check — see the
    // SECURITY NOTE at the top of this file.
    requireCaseChangeRole(req.user, commitPayload);

    const applyResult = await CaseService.resolveAndApply(firmId, req.user, { caseId: case_id, payload: commitPayload });

    const result = {
      case_id: applyResult.case.id,
      action: applyResult.action,
      matched_by: applyResult.matchedBy,
      applied: []
    };
    if (applyResult.action === 'create') result.applied.push(`created case "${applyResult.case.name}"`);
    if (commitPayload.status) result.applied.push(`status → ${commitPayload.status}`);
    if (commitPayload.lead_attorney) result.applied.push(`lead attorney → ${commitPayload.lead_attorney}`);

    if (commitPayload.client_update) {
      const label = applyResult.case.name;
      await db.insertClientMessage({
        firmId,
        clientName: label,
        clientAvatar: label.slice(0, 2).toUpperCase(),
        subject: commitPayload.client_update.subject || 'Case Update',
        preview: commitPayload.client_update.body || '',
        timestampText: 'Just now',
        isUnread: true,
        isUrgent: !!commitPayload.client_update.urgent
      });
      result.applied.push('posted client update');
    }

    res.json(CreateOrUpdateCaseOutput.parse({
      success: true,
      requires_approval: false,
      data: { tool: 'createOrUpdateCase', case_id: applyResult.case.id, result }
    }));
  } catch (err) {
    // Business-logic failures from CaseService (ambiguous name, case not
    // found with insufficient create info, unresolvable attorney, invalid
    // status) all carry `.status` — surfaced in the same shape every other
    // copilot tool's expected errors use, rather than falling through to
    // the generic {error, code} the global handler produces (no
    // `success: false`), which the frontend's copilot response handling
    // doesn't expect.
    if (err.status) {
      return res.status(err.status).json(CreateOrUpdateCaseError.parse({ success: false, error: err.message, code: err.code }));
    }
    next(err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AUDIT LOGGING HELPER
// ════════════════════════════════════════════════════════════════════════════
async function logAuditTrail(req, action, targetId, targetType, details) {
  await db.insertAuditLog({
    firmId: req.tenantId,
    userId: req.user ? req.user.id : null,
    documentId: targetType === 'file' ? targetId : null,
    folderId: targetType === 'folder' ? targetId : null,
    action: `COPILOT_${action.toUpperCase()}`.slice(0, 50),
    ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'AI Copilot',
    details: { target_type: targetType, ...details }
  });
  console.log(`[AUDIT LOG] Copilot Action: ${action} | User: ${req.user ? req.user.full_name : 'unknown'} | Target: ${targetId} (${targetType})`);
}

module.exports = {
  searchVault,
  summarizeDocument,
  manageFiles,
  createOrUpdateCase,
  validateToolInput,
};
