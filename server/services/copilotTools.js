const db = require('../db');
const SearchService = require('./searchService');
const CaseService = require('./caseService');
const CommunicationsService = require('./communicationsService');
const { extractText } = require('./documentTextExtractor');

/**
 * AI Copilot — Tool Definitions and Executors
 *
 * The tools the Copilot can call during a chat turn, in Anthropic
 * Messages API tool format, plus the server-side executor for each.
 *
 * Three rules govern what is in this file, all of them inherited from
 * server/services/copilotSystemPrompt.js rather than invented here:
 *
 * 1. NO BILLING TOOL MAY EVER EXIST. The system prompt states that no tool
 *    may wrap /api/v1/invoices* or /api/v1/trust*, and that this is
 *    enforced at the tool-design level rather than left to the model's
 *    judgement. That is what this file is: there is no invoice or trust
 *    executor here, so a jailbroken or confused model has nothing to call.
 *    server/test/copilotChat.test.js asserts this structurally.
 *
 * 2. EVERY READ IS ROLE-SCOPED. Each executor receives the acting user and
 *    passes it to the same role-scoped service the HTTP routes use
 *    (CaseService.listCases, CommunicationsService.getConversation, etc).
 *    No executor queries the database directly in a way that would bypass
 *    scopeCasesToUser / scopeConversationsToUser.
 *
 * 3. NOTHING HERE MUTATES. Every tool below is read-only. Mutating actions
 *    are handled as PROPOSALS: the model calls `propose_change`, which
 *    records what it wants to do and returns it for the user to approve in
 *    the UI. Approval then goes through the pre-existing, already-gated
 *    /api/v1/copilot/manage-files and /api/v1/copilot/cases endpoints —
 *    which keep their own role checks and human-in-the-loop step. The chat
 *    loop is therefore incapable of writing data even if the model tries.
 */

// ═════════════════════════════════════════════════════════════════════
// Tool schemas (Anthropic Messages API `tools` format)
// ═════════════════════════════════════════════════════════════════════

const TOOL_DEFINITIONS = [
  {
    name: 'search_vault',
    description:
      'Search across documents, cases, and clients the signed-in user is allowed to see. ' +
      'Use this first whenever the user refers to a case, document, or client by name rather than by id. ' +
      'Returns matches with their real ids, which other tools take as input.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for — a name, keyword, or phrase.' },
        limit: { type: 'integer', description: 'Maximum results to return (default 8, max 25).' }
      },
      required: ['query']
    }
  },
  {
    name: 'read_document',
    description:
      'Read the actual text content of a document, so you can summarize, quote, or answer questions about ' +
      'what it SAYS. Takes a document id (get one from search_vault). Supports plain-text formats, PDFs with ' +
      'a text layer, and .docx files. If the document cannot be read (a scan with no text layer, a ' +
      'spreadsheet, an image, a file missing from disk), the result says so explicitly — in that case tell ' +
      'the user the document could not be read and why. NEVER describe the contents of a document you were ' +
      'not able to read.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'The document id, as returned by search_vault.' }
      },
      required: ['document_id']
    }
  },
  {
    name: 'list_cases',
    description: 'List the cases the signed-in user can see, with status, client, attorney and next hearing.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_case',
    description:
      'Get the full detail of one case by id: status, client, opposing party and counsel, lead attorney, ' +
      'description, plus its upcoming deadlines and its documents.',
    input_schema: {
      type: 'object',
      properties: {
        case_id: { type: 'string', description: "The case id, e.g. 'LC-2026-001'." }
      },
      required: ['case_id']
    }
  },
  {
    name: 'list_conversations',
    description:
      'List client conversation threads the signed-in user can see, with the client name, linked case, ' +
      'and unread/last-message information.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'read_conversation',
    description:
      'Read the messages in one client conversation thread. Internal staff notes are included only for ' +
      'staff-role users; a CLIENT-role session never receives them.',
    input_schema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string', description: 'The conversation id, from list_conversations.' }
      },
      required: ['conversation_id']
    }
  },
  {
    name: 'propose_change',
    description:
      'Propose a change for the user to approve. You CANNOT make changes directly — this tool only records ' +
      'what you intend to do and shows it to the user for confirmation. Use it whenever the user asks you ' +
      'to modify something (rename/move/delete a file, change a case status or attorney, tag a document). ' +
      'Describe the change precisely and completely, because the confirmation the user sees is built from ' +
      'what you pass here. After calling this, tell the user what you have proposed and that it is waiting ' +
      'on their approval. Never claim a change has been made.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['update_case', 'manage_file'],
          description: "'update_case' for case field changes, 'manage_file' for file rename/move/tag/delete."
        },
        summary: {
          type: 'string',
          description: 'One clear sentence describing the change, written for the user who must approve it.'
        },
        target_id: {
          type: 'string',
          description: 'The id of the case or document being changed.'
        },
        details: {
          type: 'object',
          description: 'The specific fields to change, e.g. {"status":"closed"} or {"operation":"rename","new_name":"X.pdf"}.'
        }
      },
      required: ['action', 'summary', 'target_id']
    }
  }
];

// Names that must never appear as a tool. Asserted in tests so that adding
// a billing tool fails loudly rather than quietly widening the Copilot's
// reach past what the system prompt promises the user.
const FORBIDDEN_TOOL_SUBSTRINGS = ['invoice', 'billing', 'trust', 'payment', 'ledger', 'reconcil'];

// ═════════════════════════════════════════════════════════════════════
// Executors
// ═════════════════════════════════════════════════════════════════════

function clampLimit(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * Runs one tool call. `ctx` carries { tenantId, user }.
 *
 * Returns a plain object that is JSON-stringified into a tool_result. A
 * failure is returned as `{ error: ... }` rather than thrown, so the model
 * can recover (e.g. search again with a different term) instead of the
 * whole turn collapsing.
 */
async function executeTool(name, input = {}, ctx) {
  const { tenantId, user, log } = ctx;

  switch (name) {
    case 'search_vault': {
      const results = await SearchService.search(
        tenantId, user, String(input.query || ''), clampLimit(input.limit, 8, 25)
      );
      return { results };
    }

    case 'read_document': {
      // Scoped read: getDocumentById applies the same firm/CLIENT-ownership
      // rules every other document read uses, so the Copilot cannot reach a
      // document its caller could not open themselves.
      const doc = await db.getDocumentById(tenantId, String(input.document_id || ''), user);
      if (!doc) {
        return { error: 'No document with that id is visible to you.' };
      }

      const extracted = await extractText(doc, log);
      if (!extracted.extractable) {
        // Deliberately shaped so the model cannot mistake this for content:
        // there is no `text` key at all on the failure path.
        return {
          document_id: doc.id,
          file_name: doc.file_name,
          readable: false,
          reason: extracted.reason
        };
      }

      return {
        document_id: doc.id,
        file_name: doc.file_name,
        case_id: doc.case_id || null,
        case_name: doc.case_name || null,
        uploaded_by: doc.author_name || null,
        updated_at: doc.updated_at,
        readable: true,
        truncated: extracted.truncated,
        total_chars: extracted.total_chars,
        text: extracted.text
      };
    }

    case 'list_cases': {
      const cases = await CaseService.listCases(tenantId, user);
      return { cases };
    }

    case 'get_case': {
      const caseId = String(input.case_id || '');
      try {
        const detail = await CaseService.getCase(tenantId, caseId, user);
        const [deadlines, documents] = await Promise.all([
          CaseService.getCaseDeadlines(tenantId, caseId, user),
          CaseService.getCaseDocuments(tenantId, caseId, user)
        ]);
        return { case: detail, deadlines, documents };
      } catch (err) {
        // A 404 here is often "another client's case", which must read as
        // nonexistent rather than forbidden.
        return { error: err.status === 404 ? 'No case with that id is visible to you.' : err.message };
      }
    }

    case 'list_conversations': {
      const conversations = await CommunicationsService.listConversations(tenantId, user);
      return { conversations };
    }

    case 'read_conversation': {
      try {
        const conversation = await CommunicationsService.getConversation(
          tenantId, String(input.conversation_id || ''), user
        );
        return { conversation };
      } catch (err) {
        return { error: err.status === 404 ? 'No conversation with that id is visible to you.' : err.message };
      }
    }

    case 'propose_change': {
      // Records intent only — see rule 3 in this file's header. The returned
      // object is surfaced to the user as a pending approval; nothing is
      // written here, and the model is told so in the result text so it
      // does not then report the change as done.
      return {
        proposed: true,
        awaiting_user_approval: true,
        action: input.action,
        summary: input.summary,
        target_id: input.target_id,
        details: input.details || {},
        note: 'Recorded as a proposal only. Nothing has been changed. The user must approve this in the UI before it takes effect.'
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  FORBIDDEN_TOOL_SUBSTRINGS,
  executeTool
};
