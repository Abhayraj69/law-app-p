const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');

// ── Environment Loading ───────────────────────────────────────────────────────
// Reads .env.local (falling back to .env) and populates process.env for any key
// not already set. This is how AI_PROVIDER_API_KEY and other secrets reach the
// app. We do NOT generate, request, or validate key values here — the user
// supplies them manually in .env.local.
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
  console.log(`[ENV] Loaded environment from ${path.basename(file)}`);
})();

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

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` SLF Practice Management Document Vault API Running`);
  console.log(` Listening on: http://localhost:${PORT}`);
  console.log(` API Endpoint: http://localhost:${PORT}/api/v1/vault/stats`);
  console.log(`=======================================================`);
});

module.exports = app;
