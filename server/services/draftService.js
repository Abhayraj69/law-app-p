const db = require('../db');
const aiProvider = require('./aiProvider');
const CaseService = require('./caseService');
const HearingService = require('./hearingService');
const MatterAnalysisService = require('./matterAnalysisService');
const draftTemplates = require('./draftTemplates');
const baseLogger = require('../utils/logger');

/**
 * Draft Service — Phase 4 (Drafting Automation)
 *
 * Turns a 'draft_needed' task (Phase 1's reminder engine — see
 * reminderEngine.js / 0022's comment on hearings.suggested_draft) into an
 * actual generated draft, built from Phase 3's chronology and issue matrix
 * rather than reading raw case documents again — matching the roadmap's
 * "built from the chronology and issue matrix rather than typed from
 * scratch," the same relationship remedy_outline already has to those two
 * in matterAnalysisService.js. If neither exists yet for the case, they
 * are generated on demand, exactly like generateRemedyOutline does.
 *
 * Every drafted section carries a `sources` pointer back to real
 * document/hearing ids on the matter, validated the same way
 * matterAnalysisService.js validates chronology/issue-matrix citations —
 * a hallucinated citation is dropped, never surfaced as real.
 *
 * A draft is never auto-filed: it is created 'pending_review' and only a
 * PARTNER's approve/reject moves it out of that state (route floors in
 * server/routes/api.js), matching Phase 2's consultation approval and the
 * Copilot's own human-vetting principle for anything AI-generated that
 * leaves the building.
 */

function notFound(what) {
  const err = new Error(`${what} not found.`);
  err.status = 404;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function wrongState(draft, expected) {
  const err = new Error(`This draft is "${draft.status}", not "${expected}" — this action isn't available right now.`);
  err.status = 409;
  err.code = 'WRONG_STATE';
  throw err;
}

function toDraftView(row) {
  return {
    id: row.id,
    case_id: row.case_id,
    hearing_id: row.hearing_id,
    task_id: row.task_id,
    template_key: row.template_key,
    template_label: draftTemplates.getTemplate(row.template_key)?.label || row.template_key,
    content: row.content,
    source_count: row.source_count,
    status: row.status,
    generated_by_name: row.generated_by_name || null,
    reviewed_by_name: row.reviewed_by_name || null,
    reviewed_at: row.reviewed_at,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/** id -> { type, label } for real document/hearing ids on this matter, used to validate AI-cited sources — same shape as matterAnalysisService.buildSourceIndex. */
async function buildSourceIndex(tenantId, caseId, user) {
  const [documentSummaries, hearings] = await Promise.all([
    CaseService.getCaseDocuments(tenantId, caseId, user),
    HearingService.listHearingsForCase(tenantId, caseId, user)
  ]);
  const index = new Map();
  for (const doc of documentSummaries) {
    index.set(doc.id, { type: 'document', label: doc.file_name });
  }
  for (const hearing of hearings) {
    index.set(hearing.id, { type: 'hearing', label: `Hearing on ${hearing.hearing_date} (${hearing.purpose || 'no stated purpose'})` });
  }
  return index;
}

function resolveSource(sourceIndex, sourceType, sourceId) {
  const entry = sourceIndex.get(sourceId);
  if (!entry || entry.type !== sourceType) return null;
  return { source_type: entry.type, source_id: sourceId, source_label: entry.label };
}

function stripFence(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

async function callForJson(systemPrompt, userPrompt, log) {
  const raw = await aiProvider.chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { temperature: 0.1, maxTokens: 6000, log }
  );
  try {
    return JSON.parse(stripFence(raw));
  } catch (err) {
    const parseErr = new Error('The AI provider did not return valid draft JSON. Try generating again.');
    parseErr.status = 422;
    parseErr.code = 'DRAFT_GENERATION_FAILED';
    throw parseErr;
  }
}

async function getOrGenerateAnalysis(tenantId, actingUser, caseId, analysisType, log) {
  const existing = await db.getLatestMatterAnalysis(tenantId, caseId, analysisType);
  if (existing) return existing;
  return MatterAnalysisService.generate(tenantId, actingUser, caseId, analysisType, log);
}

class DraftService {
  static get VALID_TEMPLATE_KEYS() {
    return draftTemplates.VALID_TEMPLATE_KEYS;
  }

  /**
   * POST /api/v1/tasks/:id/drafts/generate — the trigger this whole phase
   * exists for: a 'draft_needed' task becomes an actual generated draft.
   * template_key may be given explicitly, or inferred from the task's own
   * title (reminderEngine.js names it "Draft needed: <suggested_draft>")
   * via draftTemplates.matchTemplateKey — never guessed silently if it
   * can't be resolved either way.
   */
  static async generateFromTask(tenantId, actingUser, taskId, payload = {}, log = baseLogger) {
    const task = await db.getTaskById(tenantId, taskId);
    if (!task) throw notFound('Task');
    if (task.task_type !== 'draft_needed') {
      throw badRequest('Only a "draft_needed" task can generate a draft.', 'WRONG_TASK_TYPE');
    }
    if (!task.case_id) {
      throw badRequest('This task has no case attached to draft against.', 'NO_CASE');
    }

    const caseRow = await CaseService.getCase(tenantId, task.case_id, actingUser);

    let templateKey = payload.template_key;
    if (templateKey && !draftTemplates.VALID_TEMPLATE_KEYS.includes(templateKey)) {
      throw badRequest(`template_key must be one of: ${draftTemplates.VALID_TEMPLATE_KEYS.join(', ')}.`);
    }
    if (!templateKey) {
      templateKey = draftTemplates.matchTemplateKey(task.title);
    }
    if (!templateKey) {
      throw badRequest(
        `Could not infer a template from this task's title — pass template_key explicitly, one of: ${draftTemplates.VALID_TEMPLATE_KEYS.join(', ')}.`,
        'TEMPLATE_KEY_REQUIRED'
      );
    }
    const template = draftTemplates.getTemplate(templateKey);

    if (!aiProvider.isConfigured()) {
      const err = new Error('No AI provider is configured, so a draft cannot be generated.');
      err.status = 503;
      err.code = 'COPILOT_AI_UNAVAILABLE';
      throw err;
    }

    const [chronology, issueMatrix, sourceIndex] = await Promise.all([
      getOrGenerateAnalysis(tenantId, actingUser, task.case_id, 'chronology', log),
      getOrGenerateAnalysis(tenantId, actingUser, task.case_id, 'issue_matrix', log),
      buildSourceIndex(tenantId, task.case_id, actingUser)
    ]);

    const chronologyEvents = chronology.content?.events || [];
    const issues = issueMatrix.content?.issues || [];

    const systemPrompt =
      `You are a legal drafting assistant preparing a DRAFT ${template.label} for a law firm — this is ` +
      'a starting point for an attorney to review and complete, never a filed document. Build it strictly ' +
      'from the chronology and issue matrix you are given — do not invent facts, dates, or relief beyond ' +
      'what they support. Every section MUST cite the [document:<id>] or [hearing:<id>] tags its content is ' +
      'drawn from. Output ONLY a JSON object, no prose, no markdown fences, matching: ' +
      '{"sections":[{"heading":"string","content":"string","sources":[{"source_type":"document"|"hearing","source_id":"the id exactly as given"}]}]}. ' +
      `Produce exactly these sections, in order: ${template.sections.map(s => `"${s.heading}" (${s.guidance})`).join('; ')}.`;

    const userPrompt =
      `Case: ${caseRow.name} (${caseRow.id})\n` +
      `Task: ${task.title}${task.description ? ` — ${task.description}` : ''}\n\n` +
      `═══ CHRONOLOGY ═══\n${JSON.stringify(chronologyEvents, null, 2)}\n═══ END CHRONOLOGY ═══\n\n` +
      `═══ ISSUE MATRIX ═══\n${JSON.stringify(issues, null, 2)}\n═══ END ISSUE MATRIX ═══\n\n` +
      `Draft the ${template.label} now, as JSON only.`;

    const parsed = await callForJson(systemPrompt, userPrompt, log);
    const rawSections = Array.isArray(parsed.sections) ? parsed.sections : [];

    const sections = rawSections
      .map(s => {
        const sources = (Array.isArray(s.sources) ? s.sources : [])
          .map(src => resolveSource(sourceIndex, src.source_type, String(src.source_id || '')))
          .filter(Boolean);
        return {
          heading: String(s.heading || '').trim(),
          content: String(s.content || '').trim(),
          sources
        };
      })
      .filter(s => s.heading && s.content);

    if (!sections.length) {
      throw badRequest('The AI provider returned no usable draft content — try generating again.', 'DRAFT_EMPTY');
    }

    const content = {
      sections,
      built_from: { chronology_id: chronology.id, issue_matrix_id: issueMatrix.id },
      generated_at: new Date().toISOString()
    };

    const row = await db.insertDraft({
      firmId: tenantId, caseId: task.case_id, hearingId: task.hearing_id || null, taskId: task.id,
      templateKey, content, sourceCount: sourceIndex.size, generatedByUserId: actingUser.id
    });

    if (task.status === 'open') {
      await db.updateTaskFields(tenantId, task.id, { status: 'in_progress' });
    }

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'GENERATE_DRAFT',
      details: { draft_id: row.id, task_id: task.id, case_id: task.case_id, template_key: templateKey, section_count: sections.length }
    });

    return toDraftView(row);
  }

  /** GET /api/v1/drafts/:id */
  static async getDraft(tenantId, draftId, user) {
    const row = await db.getDraftById(tenantId, draftId);
    if (!row) throw notFound('Draft');
    await CaseService.getCase(tenantId, row.case_id, user); // throws 404 if not visible to this user
    return toDraftView(row);
  }

  /** GET /api/v1/cases/:id/drafts */
  static async listDraftsForCase(tenantId, caseId, user) {
    await CaseService.getCase(tenantId, caseId, user);
    const rows = await db.listDraftsForCase(tenantId, caseId);
    return rows.map(toDraftView);
  }

  /**
   * PATCH /api/v1/drafts/:id/approve — pending_review -> approved. Marks
   * the generating task 'done' if it's still open/in_progress, since the
   * draft it needed now exists and has been signed off on.
   */
  static async approveDraft(tenantId, actingUser, draftId) {
    const existing = await db.getDraftById(tenantId, draftId);
    if (!existing) throw notFound('Draft');
    if (existing.status !== 'pending_review') wrongState(existing, 'pending_review');

    const row = await db.updateDraftFields(tenantId, draftId, {
      status: 'approved', reviewedByUserId: actingUser.id, reviewedAt: new Date()
    });

    if (existing.task_id) {
      const task = await db.getTaskById(tenantId, existing.task_id);
      if (task && task.status !== 'done' && task.status !== 'dismissed') {
        await db.updateTaskFields(tenantId, existing.task_id, { status: 'done' });
      }
    }

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'APPROVE_DRAFT',
      details: { draft_id: draftId, case_id: existing.case_id }
    });

    return toDraftView(row);
  }

  /**
   * PATCH /api/v1/drafts/:id/reject — pending_review -> rejected. Reopens
   * the generating task (back to 'open') so it can be regenerated, rather
   * than leaving it stuck 'in_progress' with a dead-end rejected draft as
   * its only output.
   */
  static async rejectDraft(tenantId, actingUser, draftId, reason) {
    const existing = await db.getDraftById(tenantId, draftId);
    if (!existing) throw notFound('Draft');
    if (existing.status !== 'pending_review') wrongState(existing, 'pending_review');
    if (!reason || !reason.trim()) {
      throw badRequest('A reason is required to reject a draft.');
    }

    const row = await db.updateDraftFields(tenantId, draftId, {
      status: 'rejected', reviewedByUserId: actingUser.id, reviewedAt: new Date(), rejectionReason: reason.trim()
    });

    if (existing.task_id) {
      const task = await db.getTaskById(tenantId, existing.task_id);
      if (task && task.status === 'in_progress') {
        await db.updateTaskFields(tenantId, existing.task_id, { status: 'open' });
      }
    }

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'REJECT_DRAFT',
      details: { draft_id: draftId, case_id: existing.case_id, reason: reason.trim() }
    });

    return toDraftView(row);
  }
}

module.exports = DraftService;
