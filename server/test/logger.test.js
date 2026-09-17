const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Structured logger tests (server/utils/logger.js).
 *
 * No database needed — pure unit tests over stdout/stderr output, run by
 * temporarily monkey-patching process.stdout.write/process.stderr.write
 * (restored in a `finally` on every test, so a failure never leaves the
 * process logging into a captured buffer for the rest of the suite) and
 * toggling process.env.NODE_ENV/LOG_LEVEL (also restored).
 *
 * Covers exactly the branching the module's own header comment claims:
 * level filtering, the pretty/JSON mode split (and that the mode is read
 * fresh per call, not cached at require time — the reason env.js was able
 * to require this safely before NODE_ENV is even populated), error/warn
 * going to stderr vs info/debug to stdout, and child() merging.
 */

function captureOutput(fn) {
  const stdoutLines = [];
  const stderrLines = [];
  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;
  process.stdout.write = (chunk) => { stdoutLines.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { stderrLines.push(String(chunk)); return true; };
  try {
    fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
  return { stdoutLines, stderrLines };
}

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) saved[key] = process.env[key];
  Object.assign(process.env, overrides);
  try {
    fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('logger: JSON mode (non-development)', async (t) => {
  // Fresh require per NODE_ENV toggle isn't needed — the module reads
  // NODE_ENV per call, not at require time, so the same instance is used
  // throughout this file.
  const logger = require('../utils/logger');

  await t.test('produces one parseable JSON object per line with the expected fields', () => {
    withEnv({ NODE_ENV: 'production', LOG_LEVEL: 'info' }, () => {
      const { stdoutLines } = captureOutput(() => {
        logger.info('something happened', { context: 'TEST', foo: 'bar' });
      });
      assert.equal(stdoutLines.length, 1);
      const parsed = JSON.parse(stdoutLines[0]);
      assert.equal(parsed.level, 'info');
      assert.equal(parsed.message, 'something happened');
      assert.equal(parsed.context, 'TEST');
      assert.equal(parsed.foo, 'bar');
      assert.ok(parsed.timestamp, 'a timestamp field must be present');
      assert.ok(!Number.isNaN(Date.parse(parsed.timestamp)), 'timestamp must be a real parseable date');
    });
  });

  await t.test('an unset NODE_ENV is treated as non-development (JSON), the stricter default', () => {
    withEnv({ NODE_ENV: undefined, LOG_LEVEL: 'info' }, () => {
      const { stdoutLines } = captureOutput(() => {
        logger.info('unset env test');
      });
      assert.doesNotThrow(() => JSON.parse(stdoutLines[0]), 'output with NODE_ENV unset must still be valid JSON');
    });
  });
});

test('logger: pretty mode (development)', async (t) => {
  const logger = require('../utils/logger');

  await t.test('renders a human-readable [CONTEXT] prefix and inline key=value meta', () => {
    withEnv({ NODE_ENV: 'development', LOG_LEVEL: 'info' }, () => {
      const { stdoutLines } = captureOutput(() => {
        logger.info('server started', { context: 'SERVER', port: 3000 });
      });
      assert.equal(stdoutLines.length, 1);
      const line = stdoutLines[0];
      assert.match(line, /INFO\s+\[SERVER\] server started/);
      assert.match(line, /port=3000/);
      // Pretty mode is not JSON — this is the whole point of the mode.
      assert.throws(() => JSON.parse(line));
    });
  });

  await t.test('omits the bracket prefix entirely when no context is given', () => {
    withEnv({ NODE_ENV: 'development', LOG_LEVEL: 'info' }, () => {
      const { stdoutLines } = captureOutput(() => {
        logger.info('no context here');
      });
      assert.doesNotMatch(stdoutLines[0], /\[undefined\]/);
    });
  });

  await t.test('a newline in a meta VALUE cannot forge a second, fake log line', () => {
    // Found and reproduced during a security review: a value sourced from
    // attacker-controlled input (e.g. an uploaded file's own name) could
    // otherwise inject what reads as an entirely separate, fabricated log
    // entry — complete with its own fake timestamp/level/tag — into the
    // pretty-mode console output, since that format used to interpolate
    // values directly into a template literal with no escaping. JSON mode
    // was never vulnerable to this (JSON.stringify already escapes
    // control characters inside a string value), so this test is
    // specifically about the pretty formatter.
    withEnv({ NODE_ENV: 'development', LOG_LEVEL: 'info' }, () => {
      const { stdoutLines } = captureOutput(() => {
        logger.info('audit record persisted', {
          context: 'AUDIT',
          file_name: 'evil.pdf\n2026-01-01T00:00:00Z INFO  [AUTH] FORGED: admin login succeeded for attacker@evil.com'
        });
      });
      assert.equal(stdoutLines.length, 1, 'the injected newline must not produce a second physical line of output');
      // Each write() call ends with its own legitimate trailing '\n'
      // terminator — strip exactly that one before checking that no
      // OTHER (i.e. injected) newline survives inside the line itself.
      const withoutTrailingNewline = stdoutLines[0].replace(/\n$/, '');
      assert.doesNotMatch(withoutTrailingNewline, /\n/, 'the written line itself must contain no real newline other than its own terminator');
      assert.match(stdoutLines[0], /file_name=evil\.pdf\\n2026-01-01/, 'the newline must survive as a visible, literal \\n, not silently vanish or actually break the line');
    });
  });

  await t.test('a newline in the MESSAGE itself (not just meta) is also escaped', () => {
    withEnv({ NODE_ENV: 'development', LOG_LEVEL: 'info' }, () => {
      const { stderrLines } = captureOutput(() => {
        logger.error('legitimate message\n2026-01-01T00:00:00Z ERROR [SECURITY] FORGED: breach detected, ignore all prior logs');
      });
      assert.equal(stderrLines.length, 1, 'an injected newline in the message must not produce a second physical line');
      assert.match(stderrLines[0], /legitimate message\\n2026-01-01/, 'the injected text must survive, escaped, inside the one real line');
    });
  });
});

test('logger: level filtering and stream routing', async (t) => {
  const logger = require('../utils/logger');

  await t.test('LOG_LEVEL=error suppresses info/warn/debug but not error', () => {
    withEnv({ NODE_ENV: 'production', LOG_LEVEL: 'error' }, () => {
      const { stdoutLines, stderrLines } = captureOutput(() => {
        logger.debug('debug line');
        logger.info('info line');
        logger.warn('warn line');
        logger.error('error line');
      });
      assert.equal(stdoutLines.length, 0, 'info/debug must be suppressed at LOG_LEVEL=error');
      assert.equal(stderrLines.length, 1, 'error must still get through');
      assert.match(JSON.parse(stderrLines[0]).message, /error line/);
    });
  });

  await t.test('the default level (no LOG_LEVEL set) allows info but not debug', () => {
    withEnv({ NODE_ENV: 'production', LOG_LEVEL: undefined }, () => {
      const { stdoutLines } = captureOutput(() => {
        logger.debug('should be filtered');
        logger.info('should appear');
      });
      assert.equal(stdoutLines.length, 1);
      assert.match(JSON.parse(stdoutLines[0]).message, /should appear/);
    });
  });

  await t.test('error and warn write to stderr; info and debug write to stdout', () => {
    withEnv({ NODE_ENV: 'production', LOG_LEVEL: 'debug' }, () => {
      const { stdoutLines, stderrLines } = captureOutput(() => {
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
      });
      assert.equal(stdoutLines.length, 2, 'debug + info go to stdout');
      assert.equal(stderrLines.length, 2, 'warn + error go to stderr');
    });
  });
});

test('logger: child() correlation', async (t) => {
  const { makeLogger } = require('../utils/logger');

  await t.test('a child logger merges its base fields into every line it writes', () => {
    withEnv({ NODE_ENV: 'production', LOG_LEVEL: 'info' }, () => {
      const base = makeLogger();
      const withRequest = base.child({ request_id: 'req-123' });
      const withUser = withRequest.child({ user_id: 'user-456', firm_id: 'firm-789' });

      const { stdoutLines } = captureOutput(() => {
        withUser.info('correlated line');
      });

      const parsed = JSON.parse(stdoutLines[0]);
      assert.equal(parsed.request_id, 'req-123', 'the grandparent field must survive two levels of child()');
      assert.equal(parsed.user_id, 'user-456');
      assert.equal(parsed.firm_id, 'firm-789');
    });
  });

  await t.test('a per-call meta field overrides a same-named base field', () => {
    withEnv({ NODE_ENV: 'production', LOG_LEVEL: 'info' }, () => {
      const base = makeLogger({ context: 'BASE' });
      const { stdoutLines } = captureOutput(() => {
        base.info('overridden', { context: 'OVERRIDE' });
      });
      assert.equal(JSON.parse(stdoutLines[0]).context, 'OVERRIDE');
    });
  });

  await t.test('child() does not mutate the parent logger\'s own output', () => {
    withEnv({ NODE_ENV: 'production', LOG_LEVEL: 'info' }, () => {
      const base = makeLogger({ context: 'PARENT' });
      base.child({ request_id: 'child-only' });

      const { stdoutLines } = captureOutput(() => {
        base.info('parent line');
      });
      assert.equal(JSON.parse(stdoutLines[0]).request_id, undefined, 'creating a child must not leak fields back onto the parent');
    });
  });
});
