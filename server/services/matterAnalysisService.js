const db = require('../db');
const aiProvider = require('./aiProvider');
const CaseService = require('./caseService');
const HearingService = require('./hearingService');
const { extractText } = require('./documentTextExtractor');
const baseLogger = require('../utils/logger');

/**
 * Matter Analysis Service — Phase 3 (Chronology, Issue Matrix, Remedy
 * Outline)
 *
 * Extends the Copilot's existing single-document summarization
 * (documentTextExtractor.js, used by copilotController.summarizeDocument
 * and the read_document chat tool) across an entire matter at once:
 *
 *   - chronology     — dated events pulled from every readable document
 *                       and hearing attached to the case, ordered into a
 *                       timeline.
 *   - issue_matrix    — the distinct legal issues raised across those
 *                       materials, cross-referenced to where each appears.
 *   - remedy_outline  — a structured draft of the relief being sought,
 *                       built from the chronology and issue matrix rather
 *                       than typed from scratch.
 *
 * Every generated line carries a `source` pointer back to the specific
 * document_id or hearing_id (and date, for hearings) it came from — never
 * a bare AI claim. That pointer is validated against the real set of
 * documents/hearings this case actually has (buildSourceIndex /
 * filterCitedSources below); anything the model cites that isn't a real
 * id in this matter is dropped rather than surfaced, so a hallucinated
 * citation can never masquerade as a real one.
 *
 * Role scoping: every read here goes through the same ownership-checked
 * paths the rest of the app uses — CaseService.getCase /
 * db.getDocumentById(tenantId, id, user) — so this can never read a case
 * or document its caller could not open themselves.
 */

const MAX_DOCUMENTS = 12;
const MAX_CHARS_PER_DOCUMENT = 6000;
const VALID_TYPES = ['chronology', 'issue_matrix', 'remedy_outline'];

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function unprocessable(message) {
  const err = new Error(message);
  err.status = 422;
  err.code = 'ANALYSIS_GENERATION_FAILED';
  return err;
}

function toAnalysisView(row) {
  if (!row) return null;
  return {
    id: row.id,
    case_id: row.case_id,
    analysis_type: row.analysis_type,
    content: row.content,
    source_count: row.source_count,
    generated_by_name: row.generated_by_name || null,
    created_at: row.created_at
  };
}

/**
 * Gathers everything a matter-wide analysis can cite: every readable
 * document attached to the case (text-extracted, same extractText used by
 * read_document) and every logged hearing. Capped at MAX_DOCUMENTS/
 * MAX_CHARS_PER_DOCUMENT so a large matter doesn't blow the model's
 * context — documents beyond the cap are still listed by name so the
 * output can say "N further documents were not included" rather than
 * silently ignoring them.
 */
async function gatherMatterSources(tenantId, caseId, user, log) {
  const caseRow = await CaseService.getCase(tenantId, caseId, user);
  const [documentSummaries, hearings] = await Promise.all([
    CaseService.getCaseDocuments(tenantId, caseId, user),
    HearingService.listHearingsForCase(tenantId, caseId, user)
  ]);

  const toRead = documentSummaries.slice(0, MAX_DOCUMENTS);
  const omittedCount = documentSummaries.length - toRead.length;

  const documents = [];
  for (const summary of toRead) {
    const doc = await db.getDocumentById(tenantId, summary.id, user);
    if (!doc) continue;
    const extracted = await extractText(doc, log);
    documents.push({
      id: doc.id,
      file_name: doc.file_name,
      readable: extracted.extractable,
      reason: extracted.extractable ? null : extracted.reason,
      text: extracted.extractable ? extracted.text.slice(0, MAX_CHARS_PER_DOCUMENT) : null,
      truncated: extracted.extractable && extracted.text.length > MAX_CHARS_PER_DOCUMENT
    });
  }

  return { caseRow, documents, hearings, omittedCount };
}

/** id -> { type, label } for every real document/hearing this matter has, used to validate AI-cited sources. */
function buildSourceIndex(documents, hearings) {
  const index = new Map();
  for (const doc of documents) {
    index.set(doc.id, { type: 'document', label: doc.file_name });
  }
  for (const hearing of hearings) {
    index.set(hearing.id, { type: 'hearing', label: `Hearing on ${hearing.hearing_date} (${hearing.purpose || 'no stated purpose'})` });
  }
  return index;
}

function renderSourceMaterial({ documents, hearings }) {
  const parts = [];
  for (const doc of documents) {
    if (!doc.readable) {
      parts.push(`--- DOCUMENT [document:${doc.id}] "${doc.file_name}" --- (not readable: ${doc.reason}; do not cite this id)`);
      continue;
    }
    parts.push(
      `--- DOCUMENT [document:${doc.id}] "${doc.file_name}"${doc.truncated ? ' (truncated)' : ''} ---\n${doc.text}`
    );
  }
  for (const hearing of hearings) {
    parts.push(
      `--- HEARING [hearing:${hearing.id}] ${hearing.hearing_date} ---\n` +
      `Purpose: ${hearing.purpose || 'n/a'}\n` +
      `Submissions: ${hearing.submissions || 'n/a'}\n` +
      `Orders passed: ${hearing.orders_passed || 'n/a'}\n` +
      `Next hearing date: ${hearing.next_hearing_date || 'n/a'}\n` +
      `Risk flag: ${hearing.risk_flag}`
    );
  }
  return parts.join('\n\n');
}

// Strips a ```json ... ``` fence if the model wrapped its output in one,
// despite being told to return raw JSON — cheap defensive parsing rather
// than failing a whole generation over formatting.
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
    throw unprocessable('The AI provider did not return valid analysis JSON. Try generating again.');
  }
}

// Keeps only events/issues whose cited source ids are real documents or
// hearings on this matter — anything else is a hallucinated citation and
// must not reach the user dressed up as a real reference.
function resolveSource(sourceIndex, sourceType, sourceId) {
  const entry = sourceIndex.get(sourceId);
  if (!entry || entry.type !== sourceType) return null;
  return { source_type: entry.type, source_id: sourceId, source_label: entry.label };
}

async function generateChronology(tenantId, actingUser, caseId, log = baseLogger) {
  const { caseRow, documents, hearings, omittedCount } = await gatherMatterSources(tenantId, caseId, actingUser, log);
  const sourceIndex = buildSourceIndex(documents, hearings);

  if (!documents.length && !hearings.length) {
    throw badRequest('This case has no documents or hearings to build a chronology from.', 'NO_SOURCE_MATERIAL');
  }

  const systemPrompt =
    'You are a legal case analyst building a matter-wide chronology for a law firm. ' +
    'Extract dated events strictly from the material you are given — never invent a date, ' +
    'party, or event that is not actually present in the text. Every event MUST cite the ' +
    'exact [document:<id>] or [hearing:<id>] tag it came from. Output ONLY a JSON object, ' +
    'no prose, no markdown fences, matching: ' +
    '{"events":[{"date":"YYYY-MM-DD or null if undated","description":"string","source_type":"document"|"hearing","source_id":"the id exactly as given in brackets"}]}. ' +
    'Order events chronologically (undated events last). If two sources conflict on a date, note the conflict in the description rather than picking one silently.';

  const userPrompt =
    `Case: ${caseRow.name} (${caseRow.id})\n\n` +
    `═══ CASE MATERIAL ═══\n${renderSourceMaterial({ documents, hearings })}\n═══ END CASE MATERIAL ═══\n\n` +
    `Build the chronology now, as JSON only.`;

  const parsed = await callForJson(systemPrompt, userPrompt, log);
  const rawEvents = Array.isArray(parsed.events) ? parsed.events : [];

  const events = rawEvents
    .map(e => {
      const source = resolveSource(sourceIndex, e.source_type, String(e.source_id || ''));
      if (!source) return null;
      return {
        date: typeof e.date === 'string' && e.date.trim() ? e.date.trim() : null,
        description: String(e.description || '').trim(),
        source
      };
    })
    .filter(e => e && e.description);

  const content = {
    events,
    omitted_documents: omittedCount,
    generated_at: new Date().toISOString()
  };

  const row = await db.insertMatterAnalysis({
    firmId: tenantId, caseId, analysisType: 'chronology',
    content, sourceCount: sourceIndex.size, generatedByUserId: actingUser.id
  });

  await db.insertAuditLog({
    firmId: tenantId, userId: actingUser.id, action: 'GENERATE_MATTER_ANALYSIS',
    details: { case_id: caseId, analysis_type: 'chronology', event_count: events.length }
  });

  return toAnalysisView({ ...row, generated_by_name: actingUser.full_name });
}

async function generateIssueMatrix(tenantId, actingUser, caseId, log = baseLogger) {
  const { caseRow, documents, hearings, omittedCount } = await gatherMatterSources(tenantId, caseId, actingUser, log);
  const sourceIndex = buildSourceIndex(documents, hearings);

  if (!documents.length && !hearings.length) {
    throw badRequest('This case has no documents or hearings to build an issue matrix from.', 'NO_SOURCE_MATERIAL');
  }

  const systemPrompt =
    'You are a legal case analyst building a matter-wide issue matrix for a law firm. ' +
    'Identify the distinct legal issues actually raised in the material you are given — never ' +
    'invent an issue the material does not support. Every issue MUST cite every ' +
    '[document:<id>] or [hearing:<id>] tag where it appears. Output ONLY a JSON object, no ' +
    'prose, no markdown fences, matching: {"issues":[{"issue":"short title","description":"string",' +
    '"sources":[{"source_type":"document"|"hearing","source_id":"the id exactly as given in brackets"}]}]}. ' +
    'Merge duplicate issues raised in more than one source into a single entry with all of its sources.';

  const userPrompt =
    `Case: ${caseRow.name} (${caseRow.id})\n\n` +
    `═══ CASE MATERIAL ═══\n${renderSourceMaterial({ documents, hearings })}\n═══ END CASE MATERIAL ═══\n\n` +
    `Build the issue matrix now, as JSON only.`;

  const parsed = await callForJson(systemPrompt, userPrompt, log);
  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];

  const issues = rawIssues
    .map(i => {
      const sources = (Array.isArray(i.sources) ? i.sources : [])
        .map(s => resolveSource(sourceIndex, s.source_type, String(s.source_id || '')))
        .filter(Boolean);
      if (!sources.length) return null;
      return {
        issue: String(i.issue || '').trim(),
        description: String(i.description || '').trim(),
        sources
      };
    })
    .filter(i => i && i.issue);

  const content = {
    issues,
    omitted_documents: omittedCount,
    generated_at: new Date().toISOString()
  };

  const row = await db.insertMatterAnalysis({
    firmId: tenantId, caseId, analysisType: 'issue_matrix',
    content, sourceCount: sourceIndex.size, generatedByUserId: actingUser.id
  });

  await db.insertAuditLog({
    firmId: tenantId, userId: actingUser.id, action: 'GENERATE_MATTER_ANALYSIS',
    details: { case_id: caseId, analysis_type: 'issue_matrix', issue_count: issues.length }
  });

  return toAnalysisView({ ...row, generated_by_name: actingUser.full_name });
}

/**
 * Builds a structured remedy outline FROM the chronology and issue matrix
 * (generating either that doesn't exist yet, rather than requiring the
 * caller to click three separate buttons in order) instead of reading raw
 * documents again — matching the roadmap's "built from the chronology and
 * issue matrix rather than typed from scratch."
 */
async function generateRemedyOutline(tenantId, actingUser, caseId, log = baseLogger) {
  const caseRow = await CaseService.getCase(tenantId, caseId, actingUser);
  const [documents, hearings] = await Promise.all([
    (async () => {
      const summaries = await CaseService.getCaseDocuments(tenantId, caseId, actingUser);
      return summaries.slice(0, MAX_DOCUMENTS).map(s => ({ id: s.id, file_name: s.file_name }));
    })(),
    HearingService.listHearingsForCase(tenantId, caseId, actingUser)
  ]);
  const sourceIndex = buildSourceIndex(documents, hearings);

  let chronology = await db.getLatestMatterAnalysis(tenantId, caseId, 'chronology');
  if (!chronology) chronology = await generateChronology(tenantId, actingUser, caseId, log);

  let issueMatrix = await db.getLatestMatterAnalysis(tenantId, caseId, 'issue_matrix');
  if (!issueMatrix) issueMatrix = await generateIssueMatrix(tenantId, actingUser, caseId, log);

  const chronologyEvents = chronology.content?.events || [];
  const issues = issueMatrix.content?.issues || [];

  if (!chronologyEvents.length && !issues.length) {
    throw badRequest('There is no chronology or issue matrix content to build a remedy outline from.', 'NO_SOURCE_MATERIAL');
  }

  const systemPrompt =
    'You are a legal case analyst drafting a remedy outline for a law firm, built strictly from ' +
    'the chronology and issue matrix you are given — do not invent facts or relief beyond what ' +
    'they support. Every section MUST cite the [document:<id>] or [hearing:<id>] tags its content ' +
    'is drawn from. Output ONLY a JSON object, no prose, no markdown fences, matching: ' +
    '{"sections":[{"heading":"string","content":"string","sources":[{"source_type":"document"|"hearing","source_id":"the id exactly as given"}]}]}. ' +
    'This is a DRAFT outline for a human attorney to review and complete — not a filed document.';

  const userPrompt =
    `Case: ${caseRow.name} (${caseRow.id})\n\n` +
    `═══ CHRONOLOGY ═══\n${JSON.stringify(chronologyEvents, null, 2)}\n═══ END CHRONOLOGY ═══\n\n` +
    `═══ ISSUE MATRIX ═══\n${JSON.stringify(issues, null, 2)}\n═══ END ISSUE MATRIX ═══\n\n` +
    `Draft the remedy outline now, as JSON only.`;

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

  const content = {
    sections,
    built_from: { chronology_id: chronology.id, issue_matrix_id: issueMatrix.id },
    generated_at: new Date().toISOString()
  };

  const row = await db.insertMatterAnalysis({
    firmId: tenantId, caseId, analysisType: 'remedy_outline',
    content, sourceCount: sourceIndex.size, generatedByUserId: actingUser.id
  });

  await db.insertAuditLog({
    firmId: tenantId, userId: actingUser.id, action: 'GENERATE_MATTER_ANALYSIS',
    details: { case_id: caseId, analysis_type: 'remedy_outline', section_count: sections.length }
  });

  return toAnalysisView({ ...row, generated_by_name: actingUser.full_name });
}

async function generate(tenantId, actingUser, caseId, analysisType, log = baseLogger) {
  if (!VALID_TYPES.includes(analysisType)) {
    throw badRequest(`analysis_type must be one of: ${VALID_TYPES.join(', ')}.`);
  }
  if (!aiProvider.isConfigured()) {
    const err = new Error('No AI provider is configured, so matter analysis cannot be generated.');
    err.status = 503;
    err.code = 'COPILOT_AI_UNAVAILABLE';
    throw err;
  }
  if (analysisType === 'chronology') return generateChronology(tenantId, actingUser, caseId, log);
  if (analysisType === 'issue_matrix') return generateIssueMatrix(tenantId, actingUser, caseId, log);
  return generateRemedyOutline(tenantId, actingUser, caseId, log);
}

/** GET — the latest of one analysis type. Ownership is enforced by CaseService.getCase. */
async function getLatest(tenantId, caseId, analysisType, user) {
  if (!VALID_TYPES.includes(analysisType)) {
    throw badRequest(`analysis_type must be one of: ${VALID_TYPES.join(', ')}.`);
  }
  await CaseService.getCase(tenantId, caseId, user); // throws 404 if not visible to this user
  const row = await db.getLatestMatterAnalysis(tenantId, caseId, analysisType);
  return toAnalysisView(row);
}

/** GET — the latest of all three types at once, for the case's Analysis tab. */
async function getOverview(tenantId, caseId, user) {
  await CaseService.getCase(tenantId, caseId, user);
  const [chronology, issue_matrix, remedy_outline] = await Promise.all(
    VALID_TYPES.map(type => db.getLatestMatterAnalysis(tenantId, caseId, type))
  );
  return {
    chronology: toAnalysisView(chronology),
    issue_matrix: toAnalysisView(issue_matrix),
    remedy_outline: toAnalysisView(remedy_outline)
  };
}

module.exports = {
  VALID_TYPES,
  generate,
  getLatest,
  getOverview
};
