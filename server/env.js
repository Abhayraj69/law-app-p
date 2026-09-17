const fs = require('fs');
const path = require('path');

/**
 * Environment Loading
 *
 * Reads .env.local (falling back to .env) and populates process.env for any
 * key not already set. This is how DATABASE_URL, JWT_SECRET, and other
 * secrets reach the app. We do NOT generate, request, or validate key
 * values here — the user supplies them manually in .env.local.
 *
 * This MUST run before any module that reads process.env at import time
 * (server/db/pool.js builds its connection config on require, for example),
 * so every entry point — the server, the migration runner, the seed script —
 * requires this module first, before anything else.
 */

(function loadEnvFile() {
  const candidates = [path.join(__dirname, '..', '.env.local'), path.join(__dirname, '..', '.env')];
  const file = candidates.find(p => fs.existsSync(p));
  if (!file) return;

  const content = fs.readFileSync(file, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
  // Deliberately still a raw console.log, not server/utils/logger.js: this
  // IIFE runs at require time, before this module has even returned — a
  // require('./utils/logger') here would work (logger.js reads
  // process.env.NODE_ENV lazily per call, not at require time, precisely
  // so this ordering isn't a trap), but env.js's entire job is being the
  // very first thing every entry point requires, and giving it a
  // dependency of its own is an unnecessary complication for one
  // diagnostic line that only ever fires once, at the very start of boot.
  console.log(`[ENV] Loaded environment from ${path.basename(file)}`);
})();
