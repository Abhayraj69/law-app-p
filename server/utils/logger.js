/**
 * Structured Logger
 *
 * Replaces 40+ scattered `console.log`/`console.error` calls across the
 * server with one small, dependency-free logger. The motivation isn't
 * novelty — it's that raw console output has no level, no timestamp
 * format anyone can parse reliably, and (before this) no way to tell
 * which request produced a given line. In a request-serving app, "which
 * request logged this?" is usually the very first question anyone asks
 * when reading logs after something goes wrong, and there was previously
 * no way to answer it short of guessing from timing.
 *
 * Two output modes, chosen the same way every other "different behavior
 * outside NODE_ENV=development" decision in this app is made (ClamAV,
 * message encryption, upgrade-insecure-requests): PRETTY (human-readable,
 * matching the existing `[TAG] message` console style everyone in this
 * project is already used to reading) when NODE_ENV === 'development',
 * JSON lines otherwise — an unset NODE_ENV is treated as "not
 * development", i.e. it gets JSON, the stricter of the two. JSON is what
 * a real deployment's log aggregator (CloudWatch, Datadog, plain `jq`
 * over a file) actually wants: one parseable object per line, with
 * request_id/user_id/firm_id as real fields instead of embedded text a
 * human has to regex out.
 *
 * The mode is read fresh on every call (not cached at require time)
 * because server/env.js — which populates process.env.NODE_ENV from
 * .env.local — is required before this module could possibly know what
 * NODE_ENV will end up being, and this module is required by things env.js
 * itself logs through.
 *
 * No transport, no buffering, no async I/O: every line is a synchronous
 * process.stdout/stderr write. That is a deliberate simplicity choice for
 * an app this size, not an oversight — an async-buffered logger (which is
 * what a real logging library like pino gives you for throughput) can
 * lose its last few lines on an unclean process exit, which is exactly
 * the moment a boot-failure or crash log matters most. A synchronous
 * write is slower per line, and null for this app's request volume.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function resolveLevel() {
  const configured = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[configured] !== undefined ? LEVELS[configured] : LEVELS.info;
}

function isPretty() {
  return process.env.NODE_ENV === 'development';
}

// Renders `{a: 1, b: 'x'}` as `a=1 b=x` for the pretty format — enough to
// read at a glance in a terminal without needing to parse JSON, while
// still showing every field a JSON line would carry.
function formatMeta(meta) {
  const entries = Object.entries(meta).filter(([, v]) => v !== undefined);
  if (!entries.length) return '';
  return ' ' + entries.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
}

function write(level, message, meta) {
  if (LEVELS[level] > resolveLevel()) return;

  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;

  if (isPretty()) {
    // context is the old `[TAG]` prefix (e.g. 'DB', 'AUDIT LOG', 'COPILOT')
    // — kept as its own field rather than folded into the message string,
    // so JSON mode gets a real, filterable field instead of parsing it
    // back out of text.
    const { context, ...rest } = meta;
    const prefix = context ? `[${context}] ` : '';
    stream.write(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${prefix}${message}${formatMeta(rest)}\n`);
    return;
  }

  stream.write(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  }) + '\n');
}

function makeLogger(baseMeta = {}) {
  return {
    error(message, meta) { write('error', message, { ...baseMeta, ...meta }); },
    warn(message, meta) { write('warn', message, { ...baseMeta, ...meta }); },
    info(message, meta) { write('info', message, { ...baseMeta, ...meta }); },
    debug(message, meta) { write('debug', message, { ...baseMeta, ...meta }); },
    // Returns a new logger that merges `extra` into every line it writes,
    // on top of whatever this logger already carries. Used to attach
    // request_id at the top of the request lifecycle
    // (server/middleware/requestContext.js) and then user_id/firm_id once
    // authMiddleware resolves an identity — every log line from that point
    // on in that request carries all three without each call site having
    // to pass them individually.
    child(extra) { return makeLogger({ ...baseMeta, ...extra }); }
  };
}

// The default, request-less logger — used for boot sequence, migrations,
// seed script, and background scripts, none of which have a request to
// correlate against.
const logger = makeLogger();

module.exports = logger;
module.exports.makeLogger = makeLogger;
