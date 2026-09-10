# SLF Document Vault

An enterprise legal practice management prototype: a document vault with folders,
tags, uploads and sharing, plus an AI copilot that can search, summarize, and
(with human approval) manage files and case records.

This README exists to answer one question honestly: **what in this codebase is
real, and what is a mockup?** That line was previously blurry — three of the
five app pages render entirely from hardcoded arrays and never touch the
backend, while the other two are backed by a real (if in-memory) API. Anyone
extending this project should read this section before assuming a feature is
wired up.

## What's real

- **Document Vault page** — folders, files, search, tags, sharing, uploads.
  Talks to a real Express API under `/api/v1/vault/*` and `/api/v1/files/*`
  (see `server/routes/api.js`, `server/controllers/vaultController.js`).
- **AI Copilot drawer** — search, summarize, manage-files, and case-update
  tools under `/api/v1/copilot/*` (`server/controllers/copilotController.js`).
  Mutative tools (`manageFiles`, `createOrUpdateCase`) use a human-in-the-loop
  approval step before committing any change.
- **Authentication** — `/api/v1/auth/login` issues a signed JWT after
  verifying a password against the in-memory user store; every other API
  route requires that token via `Authorization: Bearer <token>`
  (`server/middleware/auth.js`, `server/services/authService.js`). There are
  three demo accounts, documented below.

## What's mock/static (not wired to the backend)

- **Dashboard, Active Cases, and Client Communications pages** — all three
  render from hardcoded arrays defined at the top of `app.js`
  (`CASES`, `HEARINGS`, `MESSAGES`, `ACTIVITIES`, `NOTIFICATIONS`,
  `SEARCH_DATA`, and further down `CONVERSATIONS`). Interacting with them
  updates only in-memory JS state in the browser tab; nothing is persisted
  or sent to the server. Treat these as UI mockups, not features.
- **The Postgres schema (`db/schema.sql`) is unused.** `server/db.js` will
  open a Postgres connection pool if `PGHOST`/`DATABASE_URL` is set, but no
  service or controller queries it. All data — firms, users, documents,
  folders, messages, deadlines — lives in the `inMemoryDb` object in
  `server/db.js` and resets on every server restart.

If you want any of the mock pages to become real, the pattern to copy is the
Document Vault page: add a service in `server/services/`, a controller in
`server/controllers/`, a route in `server/routes/api.js`, and replace the
corresponding hardcoded array/render function in `app.js` with an
`ApiClient` call.

## Running it locally

```bash
npm install
cp .env.example .env.local   # then fill in JWT_SECRET (a generated one is
                              # already present if you keep the repo's own
                              # .env.local) and, optionally, an AI provider key
npm start
```

Open `http://localhost:3000`. You'll land on a login screen — sign in with
one of the seed accounts:

| Email | Role |
|---|---|
| `s.jennings@slf.law` | Senior Partner |
| `m.ross@slf.law` | Associate |
| `p.nair@slf.law` | Associate |

All three share the password set in `DEMO_USER_PASSWORD` in `.env.local`
(defaults to `ChangeMe123!`). This is a single shared demo credential, not a
real per-user password system — see "Known limitations" below.

## File uploads

Uploads are real: the browser sends actual file bytes as `multipart/form-data`,
the server validates them, and the accepted file is written to disk under
`storage/uploads/<firm_id>/` (git-ignored). Validation
(`server/middleware/securityScanner.js`) checks, in order:

1. The extension against an allowlist.
2. The file's actual binary signature ("magic bytes") against what that
   extension implies — this is what actually catches a renamed executable
   or a mismatched file type, which trusting the client's claimed MIME type
   alone cannot.
3. A real ClamAV scan, **only if configured** via `CLAMAV_HOST`/`CLAMAV_PORT`.
   Without a configured scanner, the upload response and audit log say so
   explicitly (`antivirus_engine: "none"`) rather than implying a malware
   scan ran when it didn't.

Downloading a genuinely uploaded document streams the real bytes back and
matches byte-for-byte. Downloading one of the seed/demo documents in
`server/db.js` (which never had real file content) returns a clear 404
rather than a broken or fake stream.

## Known limitations

- **No antivirus engine configured by default.** Point `CLAMAV_HOST` at a
  running ClamAV daemon to get a real malware scan on top of the signature
  check; without it, only the content-signature validation runs (see above).
- **Single shared demo password**, no signup flow, no password reset, no
  per-firm user provisioning. Fine for a prototype; not production auth.
- **In-memory data only** — see "What's mock/static" above. Nothing survives
  a server restart except what happens to already be seeded in `server/db.js`,
  including any files uploaded in a previous run (their metadata is gone
  even though the file remains on disk under `storage/`).
- **Dashboard/Cases/Communications pages are static mockups**, not live
  features, as described above.
