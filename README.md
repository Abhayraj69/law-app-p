# SLF Document Vault

An enterprise legal practice management prototype: a document vault with folders,
tags, uploads and sharing, plus an AI copilot that can search, summarize, and
(with human approval) manage files and case records.

This README exists to answer one question honestly: **what in this codebase is
real, and what is a mockup?** Anyone extending this project should read this
section before assuming a feature is wired up.

## What's real

- **Document Vault page** — folders, files, search, tags, sharing, uploads.
  Talks to a real Express API under `/api/v1/vault/*` and `/api/v1/files/*`
  (see `server/routes/api.js`, `server/controllers/vaultController.js`).
- **Dashboard, Active Cases, and Client Communications pages** — all three
  talk to a real backend the same way the Document Vault page does:
  `GET /api/v1/dashboard/summary` (one aggregating endpoint for the KPI
  tiles, billing chart, hearings, messages, and activity feed —
  `server/services/dashboardService.js`), `/api/v1/cases` (list/get/create,
  plus `PATCH /api/v1/cases/:id/archive` — `server/services/caseService.js`),
  and `/api/v1/conversations` (threaded client messages, including internal
  staff notes — `server/services/communicationsService.js`). Every case and
  conversation read is scoped by role: a `CLIENT`-role user only ever sees
  their own cases and conversations (enforced in `server/db.js`, not just
  hidden client-side), and `note`-type messages are stripped from the
  response before a `CLIENT` ever sees them, not just hidden in the UI. See
  `server/test/roleScoping.test.js` for tests that actively attempt the
  forbidden reads.
- **AI Copilot drawer** — search, summarize, manage-files, and case-update
  tools under `/api/v1/copilot/*` (`server/controllers/copilotController.js`).
  Mutative tools (`manageFiles`, `createOrUpdateCase`) use a human-in-the-loop
  approval step before committing any change. Note: `createOrUpdateCase`'s
  case list and its "commit" step are still separate from the real
  `caseService.js`/`cases` table described above — it doesn't yet write to
  `cases`. Flagging this rather than claiming otherwise; wiring it up was
  outside the scope of the Dashboard/Cases/Communications pass.
- **Authentication** — `/api/v1/auth/login` issues a signed JWT after
  verifying a password against the `users` table in Postgres; every other
  API route requires that token via `Authorization: Bearer <token>`
  (`server/middleware/auth.js`, `server/services/authService.js`). There are
  five demo accounts (three staff, two client-portal), documented below.
- **Persistence** — every table in `db/schema.sql` plus `db/migrations/`
  (firms, users, cases, folders, documents, tags, shares, audit logs,
  client messages, case deadlines, invoices, conversations and
  conversation messages) is backed by a real Postgres database via
  `server/db.js` (see `server/db/pool.js` for the connection pool and
  `server/db/migrate.js` for the migration runner). Nothing resets on
  restart; the server refuses to boot at all if it can't reach Postgres.

## What's still mock/static

- **The global omnibox search** (`SEARCH_DATA` near the top of `app.js`) is
  hardcoded and does not hit the backend. It was out of scope for the
  Dashboard/Cases/Communications pass — flagged here rather than silently
  left pretending to be real.
- **No message encryption.** The brief for the Communications feature asked
  to respect "encryption/storage as already designed for the messaging
  feature" — there is no such design anywhere in this codebase. The only
  references to encryption are aspirational text in
  `docs/LEGAL_AI_COPILOT_ARCHITECTURE.md`; `conversation_messages.body` and
  every other message/field in this app is stored as plaintext in Postgres,
  same as the rest of the schema. Don't build on an assumption that
  messages are encrypted at rest — they aren't.

If you want the search page or message encryption to become real, the
pattern to copy is the same one the Document Vault, Dashboard, Cases, and
Communications pages already follow: a service in `server/services/`, a
controller in `server/controllers/`, a route in `server/routes/api.js`, and
(for a frontend feature) replacing the hardcoded array/render function in
`app.js` with an `ApiClient` call.

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
| `j.anderson@client.slf.law` | Client (attached to *Anderson v. Meridian Corp.*) |
| `e.davies@client.slf.law` | Client (attached to *Davies v. State*) |

The two `CLIENT`-role accounts exist specifically to demonstrate/exercise
role scoping — each can only see their own case and conversation, never the
other's (see `server/test/roleScoping.test.js`). The app's UI itself isn't
built as a client-facing portal yet (no page hides staff-only controls from
a `CLIENT` session), so logging in as one of these accounts shows the same
staff UI with API responses quietly filtered — the enforcement is real, the
tailored client experience isn't built yet.

Each account gets its **own** password, generated and printed once by
`npm run seed` (or set in advance via `SEED_JENNINGS_PASSWORD` /
`SEED_ROSS_PASSWORD` / `SEED_NAIR_PASSWORD` / `SEED_ANDERSON_PASSWORD` /
`SEED_DAVIES_PASSWORD` in `.env.local`) — there is no shared demo
credential. If you lose a printed password, re-run `npm run seed` with that
user's env var set to a new value.

### Getting a Postgres without Docker or admin rights

If you can't run Docker and the official installer isn't an option, you can
get a real Postgres server from npm — the `@embedded-postgres/windows-x64`
package (also `linux-x64` / `darwin-arm64`) ships genuine Postgres binaries
that need no installer, no Windows service, and no administrator rights:

```bash
mkdir pgsql-local && cd pgsql-local && npm init -y
npm install @embedded-postgres/windows-x64@17.10.0-beta.17
BIN=node_modules/@embedded-postgres/windows-x64/native/bin
"$BIN/initdb" -D data -U postgres --auth=scram-sha-256 --pwfile=<(echo "yourpassword") -E UTF8
"$BIN/pg_ctl" -D data -l logfile.txt -o "-p 5432 -c listen_addresses=127.0.0.1" start
```

Then create the two databases (`slf_vault` and `slf_vault_test`) and point
`DATABASE_URL` at the first one. Note this package ships only the server
binaries — `initdb`, `pg_ctl`, `postgres` — with no `psql`/`createdb`, so
create databases through any Postgres client (the app's own `pg` dependency
works fine).

### Running the test suite

```bash
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/slf_vault_test npm test
```

The integration tests in `server/test/` need a real (throwaway) Postgres
database to run against — without `TEST_DATABASE_URL` set, they report as
skipped rather than failing. They generate fresh ids per run and delete
their own fixtures afterwards, so they're safe to run repeatedly against the
same database. Point `TEST_DATABASE_URL` at a **separate** database from
`DATABASE_URL`; the suite does not touch the app's own data.

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
- **The global omnibox search and message encryption are still mock/absent**,
  as described in "What's still mock/static" above.
- **The dashboard's hearings widget (`case_deadlines`) and client-messages
  widget (`client_messages`) are firm-wide, not client-scoped** — those two
  tables have no per-client ownership column in the schema. This app is
  built for firm staff, not as a client-facing portal (see the note on the
  `CLIENT` demo accounts above); the case and conversation APIs that a
  client-portal experience would actually depend on ARE fully role-scoped.
- **The AI Copilot's `createOrUpdateCase` tool doesn't write to the real
  `cases` table** — see "What's real" above.
