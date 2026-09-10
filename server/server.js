// Must come first: populates process.env from .env.local before any module
// that reads configuration at import time (notably ./db/pool) is loaded.
require('./env');

const express = require('express');
const path = require('path');
const cors = require('cors');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');

const { checkConnection } = require('./db/pool');
const { runMigrations } = require('./db/migrate');

const app = express();
const PORT = process.env.PORT || 3000;

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
    code: err.code || 'SERVER_ERROR'
  });
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
