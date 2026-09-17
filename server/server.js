// Must come first: populates process.env from .env.local before any module
// that reads configuration at import time (notably ./db/pool) is loaded.
require('./env');

const express = require('express');
const path = require('path');
const cors = require('cors');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const healthController = require('./controllers/healthController');

const { securityHeaders } = require('./middleware/securityHeaders');
const { checkConnection } = require('./db/pool');
const { runMigrations } = require('./db/migrate');
const { checkClamAvRequirement } = require('./middleware/securityScanner');
const { checkMessageEncryptionRequirement } = require('./services/encryption/messageEncryptionService');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ──────────────────────────────────────────────────────
// Mounted first, ahead of CORS, static files and every route, so that even
// an error response or a 404 carries the Content-Security-Policy. See
// server/middleware/securityHeaders.js — in particular, script-src has no
// 'unsafe-inline', which is why the frontend uses data-action delegation
// rather than inline onclick attributes.
app.use(securityHeaders());

// ── CORS ──────────────────────────────────────────────────────────────────
// The frontend is served by this same Express app, so it never needs
// cross-origin access to the API — a browser calling it is always
// same-origin. Previously `cors()` reflected ANY origin, which combined
// with the old header-based "auth" meant any website could impersonate any
// user. Cross-origin access is now denied unless explicitly allow-listed
// via ALLOWED_ORIGINS (comma-separated) for a separately hosted frontend.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // No Origin header = same-origin browser navigation, or a non-browser
    // client (curl, server-to-server) — not a cross-site browser request.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static frontend file serving
app.use(express.static(path.join(__dirname, '..')));

// Health check — deliberately registered before authMiddleware is applied
// (that happens inside apiRoutes, at the top of routes/api.js), so an
// orchestrator/load balancer can poll it without a token.
app.get('/api/v1/health', healthController.getHealth);

// Auth (login is public; /me requires a token)
app.use('/api/v1/auth', authRoutes);

// API v1 Router Mount (requires a valid JWT — see server/middleware/auth.js)
app.use('/api/v1', apiRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[API ERROR]', err);

  // Multer throws a plain Error with a multer-specific `code` and no
  // .status/.statusCode — map the common cases to sensible HTTP statuses
  // instead of falling through to a generic 500.
  if (err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message, code: err.code });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    code: err.code || 'SERVER_ERROR',
    // Only CONFLICT_CHECK_HIT (see CaseService.createCase) sets this —
    // structured match detail the New Case modal needs to render the
    // conflict-warning step, not just a generic error string.
    ...(err.conflicts ? { conflicts: err.conflicts } : {})
  });
});

// The client portal is a separate static page/app from the staff SPA
// (see client-portal.html/.js) — routed explicitly here, before the staff
// catch-all below, so a clean `/portal` URL resolves to it. Access control
// is still enforced client-side (redirects a non-CLIENT/unauthenticated
// visitor to `/`) and, more importantly, server-side on every API call
// this page makes — this route just serves the static shell.
app.get('/portal', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client-portal.html'));
});

// Fallback index.html for Single-Page Routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ── Database boot check ──────────────────────────────────────────────────
// Fail fast and loud if Postgres isn't reachable or the schema can't be
// applied, rather than starting an API that will error on the first
// request that touches the database.
async function start() {
  try {
    await checkConnection();
    console.log('[DB] Connected to PostgreSQL.');
  } catch (err) {
    console.error('[DB] FATAL: could not connect to PostgreSQL.');
    console.error(`[DB] ${err.message}`);
    console.error('[DB] Set DATABASE_URL, or PGHOST/PGUSER/PGPASSWORD/PGDATABASE, in .env.local.');
    process.exit(1);
  }

  try {
    await runMigrations();
  } catch (err) {
    console.error('[DB] FATAL: migration failed.');
    console.error(`[DB] ${err.message}`);
    process.exit(1);
  }

  // Outside NODE_ENV=development, uploads require a reachable ClamAV —
  // checked here at boot (fail fast and loud) rather than only discovering
  // it's missing on the first real upload. See
  // server/middleware/securityScanner.js for the corresponding per-request
  // enforcement (an upload is refused with 503 if ClamAV becomes
  // unreachable sometime after boot).
  try {
    await checkClamAvRequirement();
    if (process.env.NODE_ENV !== 'development') {
      console.log('[SECURITY] ClamAV is reachable — malware scanning is active.');
    }
  } catch (err) {
    console.error('[SECURITY] FATAL: malware scanning requirement not met.');
    console.error(`[SECURITY] ${err.message}`);
    process.exit(1);
  }

  // Same rule, same reason, as ClamAV above: outside NODE_ENV=development,
  // sending or reading a message requires a working KMS-backed key
  // provider — checked here (which mints the firm's very first data
  // encryption key on a brand-new deployment, if none exists yet) so a
  // missing/misconfigured KMS_KEY_ARN fails the whole boot loudly instead
  // of failing silently on someone's first message.
  try {
    await checkMessageEncryptionRequirement();
    if (process.env.NODE_ENV !== 'development') {
      console.log('[SECURITY] Message encryption key provider is reachable — messages are encrypted at rest.');
    }
  } catch (err) {
    console.error('[SECURITY] FATAL: message encryption requirement not met.');
    console.error(`[SECURITY] ${err.message}`);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` SLF Practice Management Document Vault API Running`);
    console.log(` Listening on: http://localhost:${PORT}`);
    console.log(` API Endpoint: http://localhost:${PORT}/api/v1/vault/stats`);
    console.log(`=======================================================`);
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
