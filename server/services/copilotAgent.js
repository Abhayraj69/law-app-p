const Anthropic = require('@anthropic-ai/sdk');
const aiProvider = require('./aiProvider');
const { COPILOT_SYSTEM_PROMPT } = require('./copilotSystemPrompt');
const { TOOL_DEFINITIONS, executeTool } = require('./copilotTools');
const baseLogger = require('../utils/logger');

/**
 * AI Copilot — Agentic Chat Loop
 *
 * This is what finally makes the Copilot an assistant rather than a menu.
 * Before it, the "chat" was a client-side if/else ladder in app.js that
 * matched keywords ('summarize' / 'deadline' / 'bill') and called one
 * fixed endpoint per branch, and COPILOT_SYSTEM_PROMPT — a carefully
 * written instruction set — was imported by nothing at all.
 *
 * Now a real model runs a tool-calling loop over the read-only tools in
 * copilotTools.js, grounded in this firm's actual data, under that system
 * prompt.
 *
 * Provider support: tool use is implemented for Anthropic (Messages API
 * tool_use) and Google (Gemini functionDeclarations/functionCall) — the two
 * providers this deployment has actually run conversational mode against.
 * TOOL_DEFINITIONS is written once, in Anthropic's shape, and converted to
 * Gemini's shape by toGeminiTools() below; executeTool (copilotTools.js) is
 * provider-agnostic and shared by both loops. aiProvider still supports
 * OpenAI and Vercel AI for plain text completion (summarize/search), but
 * their tool-calling wire formats aren't implemented here; rather than
 * half-implement them, isAvailable() reports false for those providers and
 * the controller falls back to the previous deterministic behaviour and
 * says so, instead of pretending to be an agent that cannot call tools.
 */

// A turn is capped so a confused model cannot loop forever burning tokens.
// Eight is comfortably more than the deepest legitimate chain the current
// toolset supports (search -> get_case -> read each of a few documents).
const MAX_TOOL_ITERATIONS = 8;

// Guardrail on conversation length. The frontend sends the transcript back
// each turn (the API is stateless), and an unbounded transcript is both a
// cost and a context-window problem.
const MAX_HISTORY_MESSAGES = 40;

const CHAT_PROVIDERS = ['anthropic', 'google'];

function unavailable(message, code) {
  const err = new Error(message);
  err.status = 503;
  err.code = code;
  return err;
}

/**
 * True when a real LLM-backed chat can run. False means the caller should
 * degrade gracefully rather than error.
 */
function isAvailable() {
  if (!aiProvider.isConfigured()) return false;
  return CHAT_PROVIDERS.includes(aiProvider.getProvider());
}

/**
 * Why the agent is unavailable, in words meant for the end user.
 */
function unavailableReason() {
  if (!aiProvider.isConfigured()) {
    return 'No AI provider API key is configured, so I can only run a limited set of built-in commands.';
  }
  const provider = aiProvider.getProvider();
  if (!CHAT_PROVIDERS.includes(provider)) {
    return `Conversational mode needs the Anthropic or Google provider (AI_PROVIDER=anthropic or google); this deployment is configured for "${provider}", so I can only run a limited set of built-in commands.`;
  }
  return 'Conversational mode is unavailable.';
}

/**
 * Normalizes whatever the client sent into a plain [{role, content}] array,
 * where role is 'user'|'assistant' and content is a trimmed, non-empty
 * string. The transcript comes from the browser, so it is untrusted: roles
 * are forced to user/assistant, content is coerced to a string, empties are
 * dropped, and a leading assistant turn is trimmed (both providers require
 * the first turn to be from the user). Provider-specific wire formats are
 * built from this shared, provider-agnostic shape by each loop below.
 */
function normalizeHistory(rawMessages) {
  const messages = (Array.isArray(rawMessages) ? rawMessages : [])
    .map(m => ({
      role: m && m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m?.content === 'string' ? m.content.trim() : ''
    }))
    .filter(m => m.content.length > 0);

  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  while (trimmed.length && trimmed[0].role === 'assistant') trimmed.shift();
  return trimmed;
}

/**
 * Everything the model is told about who it is acting for. The system
 * prompt's rule 1 ("respect the acting user's role exactly as the API
 * already enforces it") is backed by real scoping in every executor, but
 * telling the model the role as well means it can explain a refusal
 * instead of silently returning nothing. Shared by both provider loops.
 */
function buildIdentity(ctx) {
  return (
    `\n\n═══ CURRENT SESSION ═══\n` +
    `You are acting for ${ctx.user.full_name} (${ctx.user.email}), whose role is ${ctx.user.role}. ` +
    `Every tool you call is already scoped to what this user may see; if a lookup returns nothing, ` +
    `it may be because it belongs to another client, and you should say you could not find it rather ` +
    `than speculating about what it might contain.\n` +
    `Today's date is ${new Date().toISOString().slice(0, 10)}.`
  );
}

/**
 * Runs one Copilot chat turn to completion, dispatching to the loop for
 * whichever provider is configured.
 *
 * @param {object} ctx  { tenantId, user, log? } — log is optional (defaults
 *   to the request-less base logger); pass the calling request's req.log
 *   so a tool failure mid-turn is correlated to the request/user that
 *   triggered it.
 * @param {Array}  history  prior turns as [{role, content}]
 * @param {string} message  the new user message
 * @returns {Promise<{reply: string, tool_calls: Array, proposals: Array}>}
 */
async function runChatTurn(ctx, history, message) {
  if (!isAvailable()) {
    throw unavailable(unavailableReason(), 'COPILOT_AI_UNAVAILABLE');
  }

  const log = ctx.log || baseLogger;
  const provider = aiProvider.getProvider();

  const normalized = normalizeHistory(history);
  normalized.push({ role: 'user', content: String(message || '').trim() });

  const identity = buildIdentity(ctx);

  if (provider === 'google') {
    return runGoogleChatTurn(ctx, normalized, identity, log);
  }
  return runAnthropicChatTurn(ctx, normalized, identity, log);
}

// ═════════════════════════════════════════════════════════════════════
// Anthropic loop (Messages API, tool_use)
// ═════════════════════════════════════════════════════════════════════

function buildAnthropicClient() {
  // The key is resolved by aiProvider so that all the existing
  // AI_PROVIDER_API_KEY / ANTHROPIC_API_KEY precedence rules keep applying
  // in one place rather than being re-implemented here.
  return new Anthropic({ apiKey: aiProvider.getApiKey() });
}

function textFrom(content) {
  return content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

async function runAnthropicChatTurn(ctx, normalized, identity, log) {
  const client = buildAnthropicClient();
  const model = aiProvider.getModel();

  // Anthropic accepts a plain string as a text-only turn's content, so the
  // shared normalized {role, content: string} shape is already valid here.
  const messages = normalized.map(m => ({ role: m.role, content: m.content }));

  const toolCalls = [];
  const proposals = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      // Adaptive thinking: the model decides when reasoning is warranted.
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: COPILOT_SYSTEM_PROMPT + identity,
          // The system prompt and tool list are identical on every request,
          // so caching the prefix makes multi-turn conversations markedly
          // cheaper. Volatile content (the transcript) comes after it.
          cache_control: { type: 'ephemeral' }
        }
      ],
      tools: TOOL_DEFINITIONS,
      messages
    });

    // A policy refusal is an HTTP 200 with no usable content — check before
    // reading blocks, per the Messages API contract.
    if (response.stop_reason === 'refusal') {
      return {
        reply: 'I can\'t help with that request.',
        tool_calls: toolCalls,
        proposals,
        stop_reason: 'refusal'
      };
    }

    if (response.stop_reason !== 'tool_use') {
      return {
        reply: textFrom(response.content) || 'I don\'t have anything to add to that.',
        tool_calls: toolCalls,
        proposals,
        stop_reason: response.stop_reason
      };
    }

    // Echo the assistant turn back verbatim — including thinking blocks,
    // which must be replayed unchanged on the same model.
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(b => b.type === 'tool_use');

    // Parallel tool calls must come back as tool_result blocks in ONE user
    // message; splitting them across messages teaches the model to stop
    // making parallel calls.
    const results = await Promise.all(toolUses.map(async (block) => {
      let result;
      try {
        result = await executeTool(block.name, block.input, ctx);
      } catch (err) {
        log.error('copilot tool threw', { context: 'COPILOT', tool: block.name, error: err.message });
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          is_error: true,
          content: JSON.stringify({ error: 'That lookup failed. Try a different approach.' })
        };
      }

      toolCalls.push({ name: block.name, input: block.input });
      if (block.name === 'propose_change' && result.proposed) {
        proposals.push(result);
      }

      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result)
      };
    }));

    messages.push({ role: 'user', content: results });
  }

  return maxIterationsReply(toolCalls, proposals);
}

// ═════════════════════════════════════════════════════════════════════
// Google (Gemini) loop — REST API, functionDeclarations/functionCall
// ═════════════════════════════════════════════════════════════════════

// Gemini's Schema type accepts the OpenAPI/JSON-Schema-style lowercase type
// names too, but the canonical wire form for google.ai.generativelanguage.
// Schema.Type is the uppercase enum name (STRING, OBJECT, ...) — converted
// here rather than risk an API that is strict about it in some region/model.
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = { ...schema };
  if (typeof out.type === 'string') out.type = out.type.toUpperCase();
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([key, value]) => [key, toGeminiSchema(value)])
    );
  }
  if (out.items) out.items = toGeminiSchema(out.items);
  return out;
}

// Computed once at module load — TOOL_DEFINITIONS doesn't change at
// runtime, so there's no reason to re-convert it on every chat turn.
const GEMINI_TOOLS = [{
  functionDeclarations: TOOL_DEFINITIONS.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.input_schema)
  }))
}];

function maxIterationsReply(toolCalls, proposals) {
  // Ran out of iterations. Say so plainly rather than returning whatever
  // half-finished text happened to be in the last turn.
  return {
    reply:
      'I looked into that but wasn\'t able to finish within my step limit for a single question. ' +
      'Could you narrow it down — for example, name the specific case or document?',
    tool_calls: toolCalls,
    proposals,
    stop_reason: 'max_iterations'
  };
}

async function callGemini(apiKey, model, body, timeout) {
  const response = await aiProvider.fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    timeout
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Google AI API error: ${response.status}`);
  }
  return data;
}

async function runGoogleChatTurn(ctx, normalized, identity, log) {
  const apiKey = aiProvider.getApiKey();
  const model = aiProvider.getModel();
  const { timeout, maxTokens } = aiProvider.getRequestConfig();

  // Gemini's roles are 'user'/'model', not 'user'/'assistant'; a text-only
  // turn is one part with a `text` field.
  const contents = normalized.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const systemInstruction = { parts: [{ text: COPILOT_SYSTEM_PROMPT + identity }] };

  const toolCalls = [];
  const proposals = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const data = await callGemini(apiKey, model, {
      systemInstruction,
      contents,
      tools: GEMINI_TOOLS,
      generationConfig: { maxOutputTokens: Math.max(maxTokens, 16000) }
    }, timeout);

    // A blocked prompt has no candidates at all — the Gemini equivalent of
    // Anthropic's stop_reason === 'refusal'.
    if (!data.candidates || !data.candidates.length) {
      return {
        reply: 'I can\'t help with that request.',
        tool_calls: toolCalls,
        proposals,
        stop_reason: 'refusal'
      };
    }

    const candidate = data.candidates[0];
    const parts = candidate.content?.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);

    if (!functionCalls.length) {
      const text = parts.filter(p => p.text).map(p => p.text).join('\n').trim();
      return {
        reply: text || 'I don\'t have anything to add to that.',
        tool_calls: toolCalls,
        proposals,
        stop_reason: candidate.finishReason || 'STOP'
      };
    }

    // Echo the model's turn back verbatim (text alongside function calls,
    // if any, must be replayed exactly as returned).
    contents.push({ role: 'model', parts });

    // Parallel function calls must come back as functionResponse parts in
    // ONE user-role turn — the Gemini equivalent of Anthropic's rule that
    // parallel tool_result blocks belong in one message.
    const responseParts = await Promise.all(functionCalls.map(async (part) => {
      const { name, args } = part.functionCall;
      let result;
      try {
        result = await executeTool(name, args || {}, ctx);
      } catch (err) {
        log.error('copilot tool threw', { context: 'COPILOT', tool: name, error: err.message });
        return { functionResponse: { name, response: { error: 'That lookup failed. Try a different approach.' } } };
      }

      toolCalls.push({ name, input: args || {} });
      if (name === 'propose_change' && result.proposed) {
        proposals.push(result);
      }

      return { functionResponse: { name, response: result } };
    }));

    contents.push({ role: 'user', parts: responseParts });
  }

  return maxIterationsReply(toolCalls, proposals);
}

module.exports = {
  runChatTurn,
  isAvailable,
  unavailableReason,
  MAX_TOOL_ITERATIONS,
  MAX_HISTORY_MESSAGES,
  // Exposed for tests that verify the Gemini tool schema conversion
  // (toGeminiSchema) actually produced a well-formed functionDeclarations
  // array — not meant to be built against by other application code.
  GEMINI_TOOLS
};
