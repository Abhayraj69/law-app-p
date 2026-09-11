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
  approval step before committing any change. `createOrUpdateCase` writes
  to the real `cases` table via `CaseService.resolveAndApply`
  (`server/services/caseService.js`) — it resolves the caller's `case_id`
  against a real case first (exact id, then an exact case_name match),
  updates it if found, or creates a genuinely new case (with a properly
  minted id — the caller's own reference string is never used as the
  literal primary key) if not found AND the payload has enough
  information to. An ambiguous name, an unresolvable attorney, or a
  not-enough-info-to-create case are all refused with a clear error
  rather than silently guessed at or ignored. See
  `server/test/copilotCase.test.js`, including a genuine concurrent-create
  race test. `searchVault`'s "cases" scope reads that same real, role-scoped
  `cases` table too (`server/test/copilotSearch.test.js`) — a `CLIENT`
  cannot search-discover another client's case through the Copilot, and a
  status/attorney change made via `createOrUpdateCase` shows up in search
  immediately, not from a stale derived snapshot.
- **Authentication** — `/api/v1/auth/login` issues a signed JWT after
  verifying a password against the `users` table in Postgres; every other
  API route requires that token via `Authorization: Bearer <token>`
  (`server/middleware/auth.js`, `server/services/authService.js`). There are
  six demo accounts (one admin, three other staff, two client-portal),
  documented below.
- **User provisioning is single-firm, admin-invite only** — there is no
  self-signup route anywhere in the app, and no way for a caller to choose
  their own firm. An `ADMIN`-role user creates an invite (Settings > Team
  Members > Invite User, or `POST /api/v1/admin/invites`); this creates a
  real user row with a random, unusable placeholder password and returns a
  one-time link. The invitee — not the admin — sets their own password by
  visiting that link (`accept-invite.html`,
  `GET`/`POST /api/v1/auth/invite/:token[/accept]`). See "Adding a user"
  below. (`server/services/inviteService.js`,
  `server/test/invite.test.js`.)
- **Persistence** — every table in `db/schema.sql` plus `db/migrations/`
  (firms, users, cases, folders, documents, tags, shares, audit logs,
  client messages, case deadlines, invoices, conversations and
  conversation messages) is backed by a real Postgres database via
  `server/db.js` (see `server/db/pool.js` for the connection pool and
  `server/db/migrate.js` for the migration runner). Nothing resets on
  restart; the server refuses to boot at all if it can't reach Postgres.
- **Message encryption at rest** — `conversation_messages.body` is
  encrypted with AES-256-GCM under a KMS-managed key (envelope
  encryption), required outside `NODE_ENV=development` the same way
  ClamAV is. See "Message encryption" below for the full design, key
  management approach, and the migration plan for pre-existing plaintext
  messages.

## What's still mock/static

- **The global omnibox search** (`SEARCH_DATA` near the top of `app.js`) is
  hardcoded and does not hit the backend. It was out of scope for the
  Dashboard/Cases/Communications pass — flagged here rather than silently
  left pretending to be real.

If you want the search page to become real, the pattern to copy is the
same one the Document Vault, Dashboard, Cases, and Communications pages
already follow: a service in `server/services/`, a controller in
`server/controllers/`, a route in `server/routes/api.js`, and (for a
frontend feature) replacing the hardcoded array/render function in
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
| `a.morgan@slf.law` | Administrator (the only role that can invite users) |
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
`npm run seed` (or set in advance via `SEED_MORGAN_PASSWORD` /
`SEED_JENNINGS_PASSWORD` / `SEED_ROSS_PASSWORD` / `SEED_NAIR_PASSWORD` /
`SEED_ANDERSON_PASSWORD` / `SEED_DAVIES_PASSWORD` in `.env.local`) — there
is no shared demo credential. If you lose a printed password, re-run
`npm run seed` with that user's env var set to a new value.

### Adding a user

Once the app is running, sign in as `a.morgan@slf.law` (the seeded
`ADMIN` account — no other seed user has that role) and go to
**Settings > Team Members > + Invite User**. Fill in name, email, and
role, and submit. There's no email integration configured (see "Known
limitations"), so the one-time invite link is shown directly in the
modal for you to copy and send the new hire however you'd normally reach
them. They open that link (`/accept-invite.html?token=...`), set their
own password, and are logged straight in — you never see or choose their
password, only they do. The same flow works via `curl`:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"a.morgan@slf.law","password":"<their password>"}' \
  | node -e "process.stdin.once('data', d => console.log(JSON.parse(d).data.token))")

curl -s -X POST http://localhost:3000/api/v1/admin/invites \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"new.hire@slf.law","fullName":"New Hire","role":"ASSOCIATE"}'
# -> { "data": { "invite_path": "/accept-invite.html?token=..." , ... } }
```

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
3. A real ClamAV scan over its INSTREAM protocol
   (`CLAMAV_HOST`/`CLAMAV_PORT`). **Required unless `NODE_ENV=development`**:
   outside development, the server refuses to boot at all if ClamAV isn't
   configured and reachable (`checkClamAvRequirement`, called from
   `server/server.js`), and if it becomes unreachable sometime after a
   successful boot (daemon crash, network partition), every upload is
   refused with `503 ANTIVIRUS_UNAVAILABLE` rather than silently falling
   back to signature-only validation. Only in development does a missing
   scanner degrade to signature-only checks — and the upload response and
   audit log say so explicitly (`antivirus_engine: "none"`) rather than
   implying a malware scan ran when it didn't. See
   `server/test/securityScanner.test.js`.

Document metadata (filename, size, uploader, case/folder association,
storage path, tags) is written to the `documents` table in Postgres, so it
survives a restart. The file bytes themselves stay on disk under
`storage/uploads/<firm_id>/`, unchanged from before. Downloading a document
whose file is missing from disk (including any seed/demo document, which
never had one) returns a clear 404 (`NO_FILE_CONTENT`) rather than a broken
or fake stream.

## Message encryption

`conversation_messages.body` — the real threaded client/staff/note
messages behind the Client Communications page — is encrypted at rest
with application-level AES-256-GCM, not just relying on Postgres/disk
encryption. Design and code: `server/services/encryption/`,
`db/migrations/0006_message_encryption.sql`,
`server/test/messageEncryption.test.js` (14 tests, including tamper
detection, key rotation, a mock-KMS envelope-encryption round trip, a
genuine concurrent key-mint race, and the backfill script below).

### Schema

```
encryption_keys                          conversation_messages
├─ id UUID PK                             ├─ ... (unchanged columns)
├─ provider  'aws_kms' | 'local'          ├─ body TEXT              (nullable now — legacy rows only)
├─ kms_key_arn TEXT (null for 'local')    ├─ body_ciphertext BYTEA
├─ wrapped_dek BYTEA  ← never plaintext   ├─ body_nonce BYTEA
├─ status 'active' | 'retired'            ├─ body_auth_tag BYTEA
├─ created_at / retired_at                └─ encryption_key_id UUID → encryption_keys.id
└─ (partial unique index: at most one
    'active' row per provider)
```

A CHECK constraint (`chk_body_encryption_consistent`) enforces that every
row is fully one representation or the other — encrypted (all four new
columns set, `body` NULL) or legacy-plaintext (`body` set, all four NULL)
— never a partial mix.

### Key management: envelope encryption

The KMS master key never leaves KMS and never encrypts message content
directly — only small 256-bit data encryption keys (DEKs). A message body
is encrypted locally under a DEK (`server/services/encryption/messageCipher.js`,
AES-256-GCM with a random 12-byte nonce per message, and AAD binding the
ciphertext to its own `(conversation_id, message id)` so a ciphertext
silently moved to a different row fails to decrypt instead of "succeeding"
with the wrong content); only the DEK's **wrapped** (KMS-encrypted) form
is ever persisted, in `encryption_keys.wrapped_dek`. This is the same
pattern AWS itself uses for S3-SSE-KMS/EBS/DynamoDB encryption — a KMS
outage doesn't take down every message read/write (decrypted DEKs are
cached in-process, never on disk), and a database compromise alone can
never recover a plaintext DEK, let alone a message.

`server/services/encryption/keyProvider.js` selects the provider with the
exact same rule `securityScanner.js` uses for ClamAV: **required unless
`NODE_ENV=development`**, checked at boot (`checkMessageEncryptionRequirement`
in `server/server.js`) — an unset `NODE_ENV`, `'test'`, `'staging'`, or a
typo all still require real KMS, not just `'production'` specifically.

- **`AwsKmsKeyProvider`** (production/anything-not-development) — set
  `KMS_KEY_ARN` to a real AWS KMS customer master key. Mints a DEK via
  `GenerateDataKeyCommand`, unwraps one via `DecryptCommand`. The KMS
  client is injectable, so `server/test/messageEncryption.test.js` proves
  the wrap/unwrap/cache/rotate logic against a mock client — this repo has
  no AWS account to test against for real, so that logic is what's
  actually verified, not AWS's own KMS implementation.
- **`LocalKeyProvider`** (development only) — no AWS account needed. A
  single master key (`MESSAGE_ENCRYPTION_LOCAL_KEY`, see `.env.example`)
  wraps/unwraps DEKs locally, using the exact same AES-256-GCM primitives
  that protect message bodies — so even in dev, a DEK is never stored
  unwrapped, and every other code path exercises the real
  read/write/rotate logic, not a simplified stand-in.

**Rotation**: either provider's `rotateKey()` retires the current active
key and mints a new one; retired keys are kept forever (never deleted) —
any message encrypted under one still needs that row to ever be decrypted
again. A message's `encryption_key_id` never changes after it's written,
even across later rotations; decrypting looks the key up by id
(`getDekById`), not by "whatever's active now".

**Concurrency**: two processes can both observe "no active key exists yet"
and race to mint the first one. A partial unique index
(`idx_one_active_key_per_provider`) makes the loser's insert fail with a
`23505`, at which point it simply re-reads and uses the winner's key
instead of erroring or minting a second active key — the same
re-resolve-on-conflict pattern `CaseService.resolveAndApply` uses for a
concurrent case-creation race.

**Known scope limit**: `encryption_keys` is not scoped per-firm — see
"Known limitations" below.

### Migration plan for existing plaintext messages

Purely additive, zero-downtime, four steps:

1. **Schema** (`db/migrations/0006_message_encryption.sql`, already
   applied by `npm run migrate`) — adds the new columns and
   `encryption_keys` table; never touches existing rows.
2. **Deploy** the encryption-aware application code (this commit). Every
   NEW message is written already-encrypted. Every READ transparently
   handles both shapes — `messageEncryptionService.resolveMessageBody`
   decrypts if `body_ciphertext` is set, or falls back to the legacy
   plaintext `body` column if not — so reads never break mid-migration.
3. **Backfill** (`npm run backfill:encrypt-messages`,
   `server/scripts/backfillMessageEncryption.js`) — encrypts every
   pre-existing plaintext row, in batches (`FOR UPDATE SKIP LOCKED`, so
   it's safe even if accidentally run twice at once), logging progress
   and a final remaining-plaintext-row count. Idempotent — safe to
   interrupt and re-run; it only ever touches rows it hasn't encrypted yet.
4. **Cleanup** — once the backfill reports 0 remaining plaintext rows,
   `db/manual-migrations/0007_drop_plaintext_message_body.sql` drops the
   now-empty `body` column for good. This file lives **outside**
   `db/migrations/` on purpose — `server/db/migrate.js` auto-applies
   everything in that directory at every boot, and this step is
   destructive and irreversible, so it must be run by a human, by hand,
   after the checklist at the top of that file is satisfied (backfill
   complete, verified 0 remaining, a recent backup exists).

This repo's own seed data (`npm run seed`) intentionally still inserts its
demo conversation messages as raw plaintext, specifically so a freshly
seeded environment has real legacy rows to exercise this whole pipeline
against — run `npm run backfill:encrypt-messages` after seeding to see it
work end to end.

## Known limitations

- **No antivirus engine configured by default in this local environment**
  (`NODE_ENV=development` in `.env.local`), so uploads here only get the
  content-signature check, not a live scan — point `CLAMAV_HOST` at a
  running ClamAV daemon to get a real malware scan on top of it. This is a
  deliberate escape hatch for development ONLY; every other `NODE_ENV`
  requires ClamAV (see "File uploads" above).
- **No email/SMTP integration** — an ADMIN's invite link (see "Adding a
  user" below) is shown once in the UI for them to relay however they
  currently reach new hires; nothing is emailed automatically.
- **The global omnibox search is still mock/absent**, as described in
  "What's still mock/static" above.
- **`encryption_keys` (message encryption) is not scoped per-firm** — one
  active key per provider is shared across the whole deployment. This app
  is explicitly single-firm (see "User provisioning" above); a genuinely
  multi-tenant deployment wanting per-tenant key isolation would need a
  `firm_id` column there and a per-firm uniqueness constraint instead of
  the current per-provider one. See "Message encryption" below.
- **The dashboard's hearings widget (`case_deadlines`) and client-messages
  widget (`client_messages`) are firm-wide, not client-scoped** — those two
  tables have no per-client ownership column in the schema. This app is
  built for firm staff, not as a client-facing portal (see the note on the
  `CLIENT` demo accounts above); the case and conversation APIs that a
  client-portal experience would actually depend on ARE fully role-scoped.
