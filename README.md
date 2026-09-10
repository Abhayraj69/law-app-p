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
  verifying a password against the `users` table in Postgres; every other
  API route requires that token via `Authorization: Bearer <token>`
  (`server/middleware/auth.js`, `server/services/authService.js`). There are
  three demo accounts, documented below.
- **Persistence** — every table in `db/schema.sql` (firms, users, cases,
  folders, documents, tags, shares, audit logs, client messages, case
  deadlines) is backed by a real Postgres database via `server/db.js`
  (see `server/db/pool.js` for the connection pool and
  `server/db/migrate.js` for the migration runner). Nothing resets on
  restart; the server refuses to boot at all if it can't reach Postgres.

## What's mock/static (not wired to the backend)

- **Dashboard, Active Cases, and Client Communications pages** — all three
  render from hardcoded arrays defined at the top of `app.js`
  (`CASES`, `HEARINGS`, `MESSAGES`, `ACTIVITIES`, `NOTIFICATIONS`,
  `SEARCH_DATA`, and further down `CONVERSATIONS`). Interacting with them
  updates only in-memory JS state in the browser tab; nothing is persisted
  or sent to the server. Treat these as UI mockups, not features.

If you want any of the mock pages to become real, the pattern to copy is the
Document Vault page: add a service in `server/services/`, a controller in
`server/controllers/`, a route in `server/routes/api.js`, and replace the
corresponding hardcoded array/render function in `app.js` with an
`ApiClient` call.

## Running it locally

You need a Postgres database (12+) reachable from the app — there is no
in-memory fallback.

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL (or PGHOST/PGDATABASE/...),
                              # JWT_SECRET, and optionally an AI provider key
npm run migrate               # applies db/schema.sql and any db/migrations/*.sql
npm run seed                  # creates the firm + three demo users
npm start
```

`npm start` also runs the migration check itself at boot (so a forgotten
`npm run migrate` won't silently leave the schema out of date), and refuses
to start entirely if Postgres isn't reachable — see the terminal output for
the exact connection error if that happens.

Open `http://localhost:3000`. You'll land on a login screen — sign in with
one of the seed accounts:

| Email | Role |
|---|---|
| `s.jennings@slf.law` | Senior Partner |
| `m.ross@slf.law` | Associate |
| `p.nair@slf.law` | Associate |

Each account gets its **own** password, generated and printed once by
`npm run seed` (or set in advance via `SEED_JENNINGS_PASSWORD` /
`SEED_ROSS_PASSWORD` / `SEED_NAIR_PASSWORD` in `.env.local`) — there is no
shared demo credential. If you lose a printed password, re-run
`npm run seed` with that user's env var set to a new value.

### Running the test suite

```bash
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/slf_vault_test npm test
```

The integration tests in `server/test/` need a real (throwaway) Postgres
database to run against — without `TEST_DATABASE_URL` set, they report as
skipped rather than failing.

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

Document metadata (filename, size, uploader, case/folder association,
storage path, tags) is written to the `documents` table in Postgres, so it
survives a restart. The file bytes themselves stay on disk under
`storage/uploads/<firm_id>/`, unchanged from before. Downloading a document
whose file is missing from disk (including any seed/demo document, which
never had one) returns a clear 404 (`NO_FILE_CONTENT`) rather than a broken
or fake stream.

## Known limitations

- **No antivirus engine configured by default.** Point `CLAMAV_HOST` at a
  running ClamAV daemon to get a real malware scan on top of the signature
  check; without it, only the content-signature validation runs (see above).
- **No signup flow or admin "invite a user" UI yet** — new users are
  currently provisioned by running `npm run seed` with new entries, not
  through the app itself. Each seed user does get a distinct, non-shared
  password (see "Running it locally" above).
- **Dashboard/Cases/Communications pages are static mockups**, not live
  features, as described above.
