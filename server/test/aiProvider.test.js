const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Unit tests for server/services/aiProvider.js's provider-selection logic
 * (getProvider/getApiKey/getModel) — no network calls, no database. Covers
 * the three original providers plus 'google' (Gemini), added alongside
 * Anthropic/OpenAI/Vercel AI SDK as a fourth selectable AI_PROVIDER.
 */

function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve('../services/aiProvider')];
    return fn(require('../services/aiProvider'));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve('../services/aiProvider')];
  }
}

const ENV_KEYS = [
  'AI_PROVIDER', 'AI_PROVIDER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'AI_API_KEY',
  'ANTHROPIC_MODEL', 'OPENAI_MODEL', 'GOOGLE_MODEL', 'VERCEL_AI_MODEL'
];

test('aiProvider.getProvider recognizes google alongside anthropic/openai/vercel-ai', () => {
  withEnv({ ...Object.fromEntries(ENV_KEYS.map(k => [k, undefined])), AI_PROVIDER: 'google' }, (aiProvider) => {
    assert.equal(aiProvider.getProvider(), 'google');
  });
});

test('aiProvider.getProvider ignores an unrecognized value and falls back to anthropic-if-keyed, else null', () => {
  withEnv({ ...Object.fromEntries(ENV_KEYS.map(k => [k, undefined])), AI_PROVIDER: 'not-a-real-provider' }, (aiProvider) => {
    assert.equal(aiProvider.getProvider(), null);
  });
  withEnv({ ...Object.fromEntries(ENV_KEYS.map(k => [k, undefined])), AI_PROVIDER: 'not-a-real-provider', ANTHROPIC_API_KEY: 'sk-ant-test' }, (aiProvider) => {
    assert.equal(aiProvider.getProvider(), 'anthropic');
  });
});

test('aiProvider.getApiKey resolves GOOGLE_API_KEY or GEMINI_API_KEY as a fallback for provider=google', () => {
  withEnv({ ...Object.fromEntries(ENV_KEYS.map(k => [k, undefined])), AI_PROVIDER: 'google', GOOGLE_API_KEY: 'goog-test-key' }, (aiProvider) => {
    assert.equal(aiProvider.getApiKey(), 'goog-test-key');
  });
  withEnv({ ...Object.fromEntries(ENV_KEYS.map(k => [k, undefined])), AI_PROVIDER: 'google', GEMINI_API_KEY: 'gemini-test-key' }, (aiProvider) => {
    assert.equal(aiProvider.getApiKey(), 'gemini-test-key');
  });
});

test('aiProvider.getApiKey prefers AI_PROVIDER_API_KEY over the provider-specific fallback', () => {
  withEnv({ ...Object.fromEntries(ENV_KEYS.map(k => [k, undefined])), AI_PROVIDER: 'google', AI_PROVIDER_API_KEY: 'primary-key', GOOGLE_API_KEY: 'fallback-key' }, (aiProvider) => {
    assert.equal(aiProvider.getApiKey(), 'primary-key');
  });
});

test('aiProvider.getApiKey throws when provider=google has no key configured at all', () => {
  withEnv({ ...Object.fromEntries(ENV_KEYS.map(k => [k, undefined])), AI_PROVIDER: 'google' }, (aiProvider) => {
    assert.throws(() => aiProvider.getApiKey(), /No AI provider API key configured/);
  });
});

test('aiProvider.getModel defaults to gemini-3.6-flash for google, and respects GOOGLE_MODEL override', () => {
  withEnv({ ...Object.fromEntries(ENV_KEYS.map(k => [k, undefined])), AI_PROVIDER: 'google' }, (aiProvider) => {
    assert.equal(aiProvider.getModel(), 'gemini-3.6-flash');
  });
  withEnv({ ...Object.fromEntries(ENV_KEYS.map(k => [k, undefined])), AI_PROVIDER: 'google', GOOGLE_MODEL: 'gemini-2.0-pro' }, (aiProvider) => {
    assert.equal(aiProvider.getModel(), 'gemini-2.0-pro');
  });
});

test('aiProvider.getStatus reports google as configured once a key is present', () => {
  withEnv({ ...Object.fromEntries(ENV_KEYS.map(k => [k, undefined])), AI_PROVIDER: 'google', GOOGLE_API_KEY: 'goog-test-key' }, (aiProvider) => {
    const status = aiProvider.getStatus();
    assert.equal(status.provider, 'google');
    assert.equal(status.configured, true);
    assert.equal(status.model, 'gemini-3.6-flash');
  });
});
