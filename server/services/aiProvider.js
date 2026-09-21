/**
 * AI Provider Service
 *
 * Wires all model calls to strictly consume process.env.AI_PROVIDER_API_KEY.
 * Supports Anthropic (Claude), OpenAI, Google (Gemini), and Vercel AI SDK.
 *
 * IMPORTANT: API keys are NEVER generated, prompted for, or managed programmatically.
 * The user must manually insert keys into .env.local.
 */

const { DEFAULT_FIRM_ID } = require('../db');
const baseLogger = require('../utils/logger');

/**
 * Get the configured AI provider from environment
 * @returns {'anthropic' | 'openai' | 'google' | 'vercel-ai'}
 */
function getProvider() {
  const provider = process.env.AI_PROVIDER?.toLowerCase();
  if (['anthropic', 'openai', 'google', 'vercel-ai'].includes(provider)) {
    return provider;
  }
  // Default to anthropic if configured, otherwise return null
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
}

/**
 * Get the API key for the configured provider
 * @throws Error if no API key is configured
 */
function getApiKey() {
  const provider = getProvider();

  // Primary key
  const primaryKey = process.env.AI_PROVIDER_API_KEY;
  if (primaryKey && primaryKey !== 'your_api_key_here') {
    return primaryKey;
  }

  // Provider-specific fallbacks
  if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  if (provider === 'google' && (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY)) {
    return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  }
  if (provider === 'vercel-ai' && process.env.AI_API_KEY) {
    return process.env.AI_API_KEY;
  }

  throw new Error(
    `No AI provider API key configured. ` +
    `Set AI_PROVIDER_API_KEY in .env.local or provider-specific key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY). ` +
    `See .env.example for details.`
  );
}

/**
 * Get the model name for the configured provider
 */
function getModel() {
  const provider = getProvider();

  if (provider === 'anthropic') {
    return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  }
  if (provider === 'openai') {
    return process.env.OPENAI_MODEL || 'gpt-4o';
  }
  if (provider === 'google') {
    return process.env.GOOGLE_MODEL || 'gemini-3.6-flash';
  }
  if (provider === 'vercel-ai') {
    return process.env.VERCEL_AI_MODEL || 'anthropic/claude-sonnet-5';
  }

  // Default fallback
  return 'claude-sonnet-5';
}

/**
 * Get request configuration
 */
function getRequestConfig() {
  return {
    timeout: parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10) || 30000,
    maxTokens: parseInt(process.env.AI_MAX_TOKENS, 10) || 4096,
    temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.2,
  };
}

/**
 * Check if AI provider is configured and available
 */
function isConfigured() {
  try {
    getApiKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get provider status for health checks
 */
function getStatus() {
  const provider = getProvider();
  const configured = isConfigured();

  return {
    provider: provider || 'none',
    model: configured ? getModel() : null,
    configured,
    hasApiKey: !!process.env.AI_PROVIDER_API_KEY || !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY || !!process.env.GOOGLE_API_KEY || !!process.env.GEMINI_API_KEY,
  };
}

/**
 * Execute a chat completion with the configured provider
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {Object} options - Override options. `options.log` (optional) is
 *   the calling request's req.log, so a failure here is correlated back
 *   to the request/user that triggered it rather than logging anonymously.
 * @returns {Promise<string>} - The assistant's response
 */
async function chatCompletion(messages, options = {}) {
  const log = options.log || baseLogger;
  const provider = getProvider();
  const apiKey = getApiKey();
  const model = options.model || getModel();
  const config = getRequestConfig();

  const requestOptions = {
    maxTokens: options.maxTokens || config.maxTokens,
    temperature: options.temperature ?? config.temperature,
    timeout: config.timeout,
  };

  try {
    if (provider === 'anthropic') {
      return await anthropicChatCompletion(messages, apiKey, model, requestOptions);
    } else if (provider === 'openai') {
      return await openaiChatCompletion(messages, apiKey, model, requestOptions);
    } else if (provider === 'google') {
      return await googleChatCompletion(messages, apiKey, model, requestOptions);
    } else if (provider === 'vercel-ai') {
      return await vercelAiChatCompletion(messages, apiKey, model, requestOptions);
    }
    throw new Error(`Unsupported provider: ${provider}`);
  } catch (err) {
    log.error('chat completion failed', { context: 'AI_PROVIDER', provider, error: err.message });
    throw err;
  }
}

/**
 * Anthropic (Claude) chat completion
 */
async function anthropicChatCompletion(messages, apiKey, model, options) {
  // Convert messages to Anthropic format
  const systemMessage = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'messages-2023-12-15',
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      system: systemMessage?.content || '',
      messages: userMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    }),
  }, options.timeout);

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || `Anthropic API error: ${response.status}`);
  }

  return data.content?.[0]?.text || '';
}

/**
 * OpenAI chat completion
 */
async function openaiChatCompletion(messages, apiKey, model, options) {
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }),
  }, options.timeout);

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API error: ${response.status}`);
  }

  return data.choices?.[0]?.message?.content || '';
}

/**
 * Google (Gemini) chat completion, via the Generative Language REST API
 * directly (no SDK dependency, same posture as the Anthropic/OpenAI
 * functions above) — https://ai.google.dev/api/generate-content
 */
async function googleChatCompletion(messages, apiKey, model, options) {
  const systemMessage = messages.find(m => m.role === 'system');
  const turnMessages = messages.filter(m => m.role !== 'system');

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(systemMessage ? { systemInstruction: { parts: [{ text: systemMessage.content }] } } : {}),
        contents: turnMessages.map(m => ({
          // Gemini's roles are 'user'/'model', not 'user'/'assistant'.
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: options.maxTokens,
          temperature: options.temperature,
        },
      }),
    },
    options.timeout
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || `Google AI API error: ${response.status}`);
  }

  return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

/**
 * Vercel AI SDK chat completion
 * Note: This requires the `ai` package to be installed
 */
async function vercelAiChatCompletion(messages, apiKey, model, options) {
  try {
    // Dynamic import to avoid hard dependency
    const { createAI } = require('ai');
    const { anthropic } = require('@ai-sdk/anthropic');
    const { openai } = require('@ai-sdk/openai');

    let provider;
    if (model.startsWith('anthropic/') || model.startsWith('claude')) {
      provider = anthropic(model.replace('anthropic/', ''));
    } else if (model.startsWith('openai/') || model.startsWith('gpt')) {
      provider = openai(model.replace('openai/', ''));
    } else {
      provider = anthropic(model);
    }

    const ai = createAI({
      provider,
      apiKey,
    });

    const { text } = await ai.generateText({
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });

    return text;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error('Vercel AI SDK not installed. Run: npm install ai @ai-sdk/anthropic @ai-sdk/openai');
    }
    throw err;
  }
}

/**
 * Fetch with timeout wrapper
 */
function fetchWithTimeout(url, options, timeout = 30000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    ),
  ]);
}

/**
 * Stream chat completion (for real-time UX)
 * @param {Array<{role: string, content: string}>} messages
 * @param {Function} onChunk - Callback for each chunk
 * @param {Object} options
 * @returns {Promise<string>} - Full response
 */
async function streamChatCompletion(messages, onChunk, options = {}) {
  const provider = getProvider();
  const apiKey = getApiKey();
  const model = options.model || getModel();
  const config = getRequestConfig();

  if (provider === 'anthropic') {
    return await anthropicStreamChatCompletion(messages, onChunk, apiKey, model, config);
  } else if (provider === 'openai') {
    return await openaiStreamChatCompletion(messages, onChunk, apiKey, model, config);
  } else if (provider === 'google') {
    return await googleStreamChatCompletion(messages, onChunk, apiKey, model, config);
  } else if (provider === 'vercel-ai') {
    // Vercel AI SDK streaming would go here
    return await vercelAiChatCompletion(messages, apiKey, model, config);
  }

  throw new Error(`Streaming not supported for provider: ${provider}`);
}

/**
 * Anthropic streaming chat completion
 */
async function anthropicStreamChatCompletion(messages, onChunk, apiKey, model, config) {
  const systemMessage = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'messages-2023-12-15',
    },
    body: JSON.stringify({
      model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: systemMessage?.content || '',
      messages: userMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      stream: true,
    })
  }, config.timeout);

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error?.message || `Anthropic API error: ${response.status}`);
  }

  let fullText = '';
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body reader available');
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
            onChunk(parsed.delta.text);
          }
        } catch {
          // Ignore parse errors for non-JSON lines
        }
      }
    }
  }

  return fullText;
}

/**
 * OpenAI streaming chat completion
 */
async function openaiStreamChatCompletion(messages, onChunk, apiKey, model, config) {
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    })
  }, config.timeout);

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error?.message || `OpenAI API error: ${response.status}`);
  }

  let fullText = '';
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body reader available');
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            onChunk(content);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  return fullText;
}

/**
 * Google (Gemini) streaming chat completion, via streamGenerateContent
 * with `alt=sse` so the response arrives as standard `data: <json>` SSE
 * lines, the same shape the Anthropic/OpenAI streaming functions parse.
 */
async function googleStreamChatCompletion(messages, onChunk, apiKey, model, config) {
  const systemMessage = messages.find(m => m.role === 'system');
  const turnMessages = messages.filter(m => m.role !== 'system');

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(systemMessage ? { systemInstruction: { parts: [{ text: systemMessage.content }] } } : {}),
        contents: turnMessages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: config.maxTokens,
          temperature: config.temperature,
        },
      }),
    },
    config.timeout
  );

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error?.message || `Google AI API error: ${response.status}`);
  }

  let fullText = '';
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body reader available');
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (!data || data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const text = (parsed.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
          if (text) {
            fullText += text;
            onChunk(text);
          }
        } catch {
          // Ignore parse errors for non-JSON lines
        }
      }
    }
  }

  return fullText;
}

module.exports = {
  getProvider,
  getApiKey,
  getModel,
  getRequestConfig,
  isConfigured,
  getStatus,
  chatCompletion,
  streamChatCompletion,
  // Exposed so other services (e.g. copilotAgent.js's Gemini tool-calling
  // loop) can make their own provider-specific requests without
  // duplicating the timeout-wrapping logic.
  fetchWithTimeout,
};