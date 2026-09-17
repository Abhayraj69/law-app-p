const Anthropic = require('@anthropic-ai/sdk');
const aiProvider = require('./aiProvider');
const { COPILOT_SYSTEM_PROMPT } = require('./copilotSystemPrompt');
const { TOOL_DEFINITIONS, executeTool } = require('./copilotTools');

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
 * Provider support: tool use is implemented against the Anthropic Messages
 * API only. aiProvider still supports OpenAI and Vercel AI for plain text
 * completion, and their tool-calling wire formats differ; rather than
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
  return aiProvider.getProvider() === 'anthropic';
}

/**
 * Why the agent is unavailable, in words meant for the end user.
 */
function unavailableReason() {
  if (!aiProvider.isConfigured()) {
    return 'No AI provider API key is configured, so I can only run a limited set of built-in commands.';
  }
  const provider = aiProvider.getProvider();
  if (provider !== 'anthropic') {
    return `Conversational mode needs the Anthropic provider (AI_PROVIDER=anthropic); this deployment is configured for "${provider}", so I can only run a limited set of built-in commands.`;
  }
  return 'Conversational mode is unavailable.';
}

function buildClient() {
  // The key is resolved by aiProvider so that all the existing
  // AI_PROVIDER_API_KEY / ANTHROPIC_API_KEY precedence rules keep applying
  // in one place rather than being re-implemented here.
  return new Anthropic({ apiKey: aiProvider.getApiKey() });
}

/**
 * Normalizes whatever the client sent into a valid Anthropic messages
 * array. The transcript comes from the browser, so it is untrusted: roles
 * are forced to user/assistant, content is coerced to a string, empties are
 * dropped, and a leading assistant turn is trimmed (the API requires the
 * first message to be `user`).
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

function textFrom(content) {
  return content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

/**
 * Runs one Copilot chat turn to completion.
 *
 * @param {object} ctx  { tenantId, user }
 * @param {Array}  history  prior turns as [{role, content}]
 * @param {string} message  the new user message
 * @returns {Promise<{reply: string, tool_calls: Array, proposals: Array}>}
 */
async function runChatTurn(ctx, history, message) {
  if (!isAvailable()) {
    throw unavailable(unavailableReason(), 'COPILOT_AI_UNAVAILABLE');
  }

  const client = buildClient();
  const model = aiProvider.getModel();

  const messages = normalizeHistory(history);
  messages.push({ role: 'user', content: String(message || '').trim() });

  // Everything the model is told about who it is acting for. The system
  // prompt's rule 1 ("respect the acting user's role exactly as the API
  // already enforces it") is backed by real scoping in every executor, but
  // telling the model the role as well means it can explain a refusal
  // instead of silently returning nothing.
  const identity =
    `\n\n═══ CURRENT SESSION ═══\n` +
    `You are acting for ${ctx.user.full_name} (${ctx.user.email}), whose role is ${ctx.user.role}. ` +
    `Every tool you call is already scoped to what this user may see; if a lookup returns nothing, ` +
    `it may be because it belongs to another client, and you should say you could not find it rather ` +
    `than speculating about what it might contain.\n` +
    `Today's date is ${new Date().toISOString().slice(0, 10)}.`;

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
        console.error(`[COPILOT] tool ${block.name} threw:`, err.message);
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

module.exports = {
  runChatTurn,
  isAvailable,
  unavailableReason,
  MAX_TOOL_ITERATIONS,
  MAX_HISTORY_MESSAGES
};
