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
- **Client Portal** — a separate, simplified app for `CLIENT`-role users at
  `/portal` (`client-portal.html`, `client-portal.js`, `client-portal.css`),
  routed explicitly in `server/server.js` ahead of the staff SPA's catch-all.
  It is not the staff SPA with filtered responses — it's its own small
  script with its own routes (My Cases, case detail, Documents, Messages,
  Invoices) calling the same role-scoped API the staff app calls. Real
  access control is server-side on every API call the page makes; the
  client-side guard is a UX redirect only. See "Client Portal" below for
  what it does and doesn't support yet.
- **`GET /api/v1/invoices`** — a real, role-scoped, read-only endpoint
  listing invoices (`server/routes/api.js`, invoice controller/service).
  Write endpoints also exist (`POST /api/v1/invoices`,
  `PATCH /api/v1/invoices/:id`, `PATCH /api/v1/invoices/:id/mark-paid`,
  gated by role) and back the staff Billing page.
- **AI Copilot** — a real conversational assistant, not a keyword matcher.
  `POST /api/v1/copilot/chat` (`server/services/copilotAgent.js`) runs an
  agentic tool-calling loop against the Anthropic Messages API, grounded in
  `server/services/copilotSystemPrompt.js` — a carefully written system
  prompt that, before this, nothing in the codebase actually imported. The
  chat surface replaces what used to be a client-side `if`/`else` ladder in
  `app.js` that matched keywords ('summarize', 'deadline', 'bill') against
  one fixed endpoint per branch and could not combine two lookups or
  remember the previous turn.

  Every tool the loop can call (`server/services/copilotTools.js`) is
  **read-only and individually role-scoped** through the same services the
  HTTP routes use — `search_vault`, `read_document`, `list_cases`,
  `get_case`, `list_conversations`, `read_conversation`. A mutating request
  (rename a file, change a case status) comes back as a `propose_change`
  the user must approve in the UI, which then goes through the pre-existing,
  already role-gated `manageFiles`/`createOrUpdateCase` endpoints below —
  the chat loop itself cannot write data even if the model tries to.
  Billing and trust accounting have **no tool and no executor at all**,
  enforced structurally rather than only by the prompt's instruction not to
  touch them (`server/test/copilotChat.test.js` asserts this).

  `summarizeDocument` now reads a document's actual text
  (`server/services/documentTextExtractor.js` — plain text, PDF text layers
  via `pdf-parse`, and `.docx` via `mammoth`) instead of summarizing only
  its filename/size/tags. An unreadable document (a scan with no text
  layer, a spreadsheet, an image) says so explicitly rather than returning
  empty text a caller might mistake for "this document is empty"; every
  summary response carries `content_read` so a metadata-only fallback can
  never be presented as though the document had been reviewed.

  Tool-calling is implemented against the Anthropic provider only — if a
  deployment is configured for OpenAI or Vercel AI instead (both still work
  for the metadata-summary fallback path), the chat endpoint returns 503
  `COPILOT_AI_UNAVAILABLE` with a clear reason rather than silently
  degrading to something that looks like a real answer.

  The original discrete tool endpoints — `searchVault`, `summarizeDocument`,
  `manageFiles`, `createOrUpdateCase`, all under `/api/v1/copilot/*`
  (`server/controllers/copilotController.js`) — are unchanged in shape and
  still directly callable; the chat endpoint is a new surface built on top
  of them, not a replacement for them. Mutative tools (`manageFiles`,
  `createOrUpdateCase`) use a human-in-the-loop
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
  `db/migrations/0009_case_description.sql` adds a nullable free-text
  `description` column to `cases` — surfaced on the Client Portal's case
  detail view, and editable by staff or the AI Copilot via the same
  `updateCaseFields` path already used for status/opposing-party edits.
- **Message encryption at rest** — `conversation_messages.body` is
  encrypted with AES-256-GCM under a KMS-managed key (envelope
  encryption), required outside `NODE_ENV=development` the same way
  ClamAV is. See "Message encryption" below for the full design, key
  management approach, and the migration plan for pre-existing plaintext
  messages.
- **The global omnibox search** — real and role-scoped
  (`GET /api/v1/search`, `server/services/searchService.js`), matching
  against the same already-role-scoped case and document reads the Active
  Cases and Document Vault pages use (`CaseService.listCases`,
  `db.listActiveDocuments`), plus a client-name facet derived from that
  same case list. A `CLIENT`-role caller can't discover another client's
  case, document, or name through it. This replaces what used to be a
  hardcoded `SEARCH_DATA` array in `app.js`.
- **Time tracking + invoice line items** — invoices used to be a single
  flat `amount_cents` with no record of what the number was actually for.
  `time_entries` (`db/migrations/0021_time_tracking_and_invoice_line_items.sql`,
  `server/services/timeEntryService.js`, `/api/v1/time-entries`) lets staff
  log billable hours against a case; `POST /api/v1/invoices/from-time-entries`
  rolls a chosen set of unbilled entries into a real, itemized invoice
  (`invoice_line_items`) atomically — the invoice, its line items, and each
  entry's `status`/`invoice_line_item_id` update all succeed or fail
  together. Every entry must belong to the same case, be billable, and
  still be `unbilled`, or the whole request is refused rather than
  silently billing a partial set. Time is stored as whole minutes and
  every money figure in whole cents — the same no-float rule as
  `trust_transactions` below — and a rate is captured on the row at the
  moment it's logged, so a later rate change never retroactively changes
  what an already-invoiced hour claims it billed at.

  Role scoping (`PARALEGAL` floor, one level above `CLIENT`, since logging
  your own time is a normal task for every staff role): a `PARALEGAL` sees
  and may edit/delete only their own unbilled entries; `ASSOCIATE`+ sees
  the whole firm's and may correct anyone's unbilled entry, but may still
  only ever create an entry under their own id — nobody logs time on
  someone else's behalf. Once an entry is invoiced it becomes immutable —
  no edit, no delete, no re-invoicing — enforced the same way an already-created
  `trust_transactions` row is: a correction happens by a new action, not by
  mutating history. `InvoiceService.updateInvoice` refuses to change
  `amount_cents` directly on an invoice that has real line items, so the
  two can never desync. The staff Billing page's "Time Entries" tab
  supports logging time, bulk-selecting unbilled entries from a single
  case, and generating the invoice in one action; an invoice generated
  this way shows its line items read-only in the Edit Invoice modal with
  the Amount field disabled. See `server/test/timeTracking.test.js`,
  including a genuine concurrency test that drives the underlying
  transaction directly to prove a race against an already-invoiced entry
  rolls back cleanly rather than double-billing it.
- **Trust Accounting** — client trust funds (retainers), deliberately kept
  structurally separate from `invoices`/operating revenue rather than
  just a column on the same table: `trust_accounts`,
  `trust_client_ledgers`, and an append-only `trust_transactions` ledger
  (`db/migrations/0014_trust_ledger.sql`,
  `server/services/trustService.js`, `/api/v1/trust/*`). Deposits and
  disbursements are rejected if they'd take a client's ledger negative; a
  correction is always a new reversing entry, never an edit or delete of
  an existing one. The only path from trust into firm revenue is
  "transfer to operating," which atomically marks the linked invoice paid
  in the same database transaction as the trust withdrawal — a client's
  retainer can never be shown as drawn down while the invoice it paid
  stays unpaid, or vice versa. A three-way reconciliation
  (bank-statement balance vs. ledger balance vs. sum of client ledger
  balances) can be computed live and saved as a dated snapshot. Every
  route, reads included, is gated to `PARTNER`+ — stricter than billing's
  `ASSOCIATE`+ floor — and none of it is reachable from the AI Copilot.
- **Matter Intake workflow** — an opt-in alternative to the plain "New
  Case" button that walks a new matter through
  `CONFLICT_PENDING → (CONFLICT_HOLD → CONFLICT_CLEARED) →
  ENGAGEMENT_LETTER_DRAFTED → ENGAGEMENT_LETTER_SENT → SIGNED →
  RETAINER_RECEIVED → ACTIVATED` before it can ever reach
  `cases.status = 'active'` (`db/migrations/0015_case_intake.sql`,
  `server/services/matterIntakeService.js`,
  `POST /api/v1/cases/intake` and `/api/v1/cases/:id/intake/*`). A
  conflict-check hit lands the matter in `CONFLICT_HOLD`, which blocks
  every later step until a `PARTNER`+ clears it as its own explicit,
  reasoned action — never as a side effect of the same request that
  created the case. The retainer step reuses Trust Accounting's real
  deposit endpoint rather than a separate mechanism (or can be explicitly
  waived, for contingency/pro bono matters). The `SIGNED` step is reached
  either by a staff member manually uploading a countersigned document
  (`POST /api/v1/cases/:id/intake/signed`) or, now, by a completed
  e-signature request tied to the case (see "Pluggable e-signature
  workflow" above) — both paths write the same
  `case_intake.signed_document_id` + `signed_at` fields. Activation itself
  (`CaseService`'s case row and `case_intake`'s state flip together in
  one transaction) hard-refuses unless every prior step is satisfied.
  Cases created through the ordinary "New Case" modal are untouched by
  any of this — they still activate immediately, exactly as before.
- **Document version history** — re-uploading a file creates a new
  version instead of overwriting it (`document_versions` table,
  `db/migrations/0016_document_versions.sql`,
  `POST/GET /api/v1/files/:id/versions`,
  `GET /api/v1/files/:id/versions/:versionId/download`). Every existing
  document was backfilled as its own version 1 on migration, and
  `GET /api/v1/files/:id/download` needed no code changes to keep serving
  whichever version is current. A "Version History" panel (uploader,
  timestamp, optional comment, a "Current" badge, and a per-version
  download link) is reachable from the Document Vault's file context menu
  and from a document's row in the Case File detail view's document list.
  A "Compare versions" view (`GET /api/v1/files/:id/versions/:v1/diff/:v2`,
  `server/services/fileService.js`) shows a real line-level diff for
  text-like formats under a size limit; anything else (PDFs, images, office
  formats, oversized files) reports `diffable:false` with a reason and
  falls back to a side-by-side view using each version's existing
  download link.
- **Content-based duplicate upload detection** — every upload is hashed
  (SHA-256) before anything is written to disk, so a byte-identical file
  already on record for the same case/folder is caught before the write,
  not after (`documents.sha256`, `db/migrations/0017_document_sha256.sql`,
  `VaultService.initiateUpload`). The caller can confirm "upload anyway"
  (`allow_duplicate`) to skip the check for a deliberate second copy.
- **Password strength, not just length** — invite acceptance (see
  "Adding a user" below) scores the chosen password with zxcvbn instead of
  only checking an 8-character minimum, penalizing ones built from the
  user's own name/email (`server/utils/passwordPolicy.js`,
  `server/services/inviteService.js`).
- **`GET /api/v1/health`** — a public, unauthenticated endpoint reporting
  Postgres/ClamAV/KMS reachability (each gated by the same "required
  unless `NODE_ENV=development`" rule boot itself uses), for use by a load
  balancer or orchestrator (`server/controllers/healthController.js`).
- **Containerized deployment** — a `Dockerfile` (a production, non-dev
  image with a `HEALTHCHECK` against `/api/v1/health`) and a minimal
  GitHub Actions CI workflow (`.github/workflows/ci.yml`) that installs
  and runs the test suite on every push/PR to `main`.
- **Rate limiting on authentication endpoints** — login and invite-accept
  are throttled per IP (`express-rate-limit`) to slow down credential
  stuffing and invite-token brute-forcing.
- **"Open Case File," "Upload to Document Index," and "Message via
  Client Portal"** (Active Cases page row actions) all do something real
  now, reusing existing views rather than each getting its own: "Open
  Case File" opens a read-only Case File modal (overview, documents,
  deadlines, activity — the same endpoints the Client Portal already
  reads); "Upload to Document Index" opens the Document Vault's own
  upload modal pre-scoped to that case; "Message via Client Portal" opens
  that case's real conversation in Communications (or says plainly that
  no thread exists yet, if one doesn't).
- **Structured message attachments** — the Communications composer's
  "Attach" quick action uploads through the same vault upload pipeline
  (`POST /api/v1/vault/upload`) as before, but now links the result to
  the message as a real reference
  (`conversation_messages.attachment_document_id`,
  `db/migrations/0018_message_attachments.sql`) instead of a plain-text
  mention the sender could edit into something misleading. Re-verified
  server-side on every post (`CommunicationsService.postMessage` calls
  `db.getDocumentById` with the same firm/CLIENT-ownership scoping every
  other document read uses) before it's ever linked. Renders as a
  clickable download chip in both the staff Communications page and the
  Client Portal's message thread.
- **Pluggable e-signature workflow** — the Communications composer's
  "Request Signature" quick action is real: it creates a
  `signature_requests` row (`db/migrations/0019_signature_requests.sql`)
  through a pluggable provider interface
  (`server/services/esignature/`), the same swappable-backend shape
  `server/services/encryption/keyProvider.js` uses for AWS KMS vs. a
  local key. Only a `'local'` provider exists today — no third-party
  account needed — the signer completes the request themselves on this
  app's own public page (`/sign-document.html?token=...`, reached via a
  one-time link, the same shape the admin-invite flow uses) by typing
  their full name; that's recorded as real signer metadata (typed name,
  IP, timestamp) on the row, not a forged re-rendering of the document.
  A request optionally carries a `case_id`; completing one for a case
  whose Matter Intake is waiting on `ENGAGEMENT_LETTER_SENT`
  auto-advances that intake to `SIGNED` using the same document
  (`MatterIntakeService.markSignedViaSignatureRequest`) — the exact
  drop-in migration 0015's own comment anticipated. Swapping in a real
  provider (DocuSign, HelloSign) later means adding one file under
  `server/services/esignature/providers/`, not touching
  `SignatureService` or the schema. See
  `server/test/messageAttachmentsAndSignatures.test.js`.
- **"Template," the third Communications composer quick action** —
  inserts one of a small fixed set of canned messages (plain string
  substitution, no merge fields, no server involvement).

If you want a real third-party e-signature provider integrated, the
pattern to copy is the same one every other real feature in this app
already follows: a service in `server/services/`, a controller in
`server/controllers/`, a route in `server/routes/api.js` — here,
specifically, one more file under `server/services/esignature/providers/`
implementing `send`/`void` against that provider's API, selected via the
`SIGNATURE_PROVIDER` env var (see `providerSelector.js`).

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
other's (see `server/test/roleScoping.test.js`). Logging in as one of these
accounts lands on the real Client Portal at `/portal` (`client-portal.html`
/ `client-portal.js`), not the staff SPA — see "Client Portal" below for
what it covers.

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

### Client Portal

`CLIENT`-role users sign in at the same login screen and land on `/portal`
(`client-portal.html`, `client-portal.js`, `client-portal.css`) — a separate,
simplified app from the staff SPA, routed explicitly in `server/server.js`
ahead of the staff catch-all. It has its own small router with its own
views: **My Cases** (a card grid of the client's own cases), a **case
detail** view (status, opposing party/counsel, and the free-text
`description` field added by `db/migrations/0009_case_description.sql`),
**Documents**, **Messages**, and **Invoices**. All of it calls the same
role-scoped API the staff app calls — the client-side route guard is a UX
convenience only; the real enforcement is server-side on every request
(see `server/test/roleScoping.test.js`).

What it does **not** support yet:

- **No account self-service** — a client cannot sign up, reset their own
  password, or change their profile from the portal. Accounts are
  provisioned the same admin-invite way as staff accounts (see "Adding a
  user" above); a client's password is set once via that invite link.
- **No notifications** — there's no email/push/in-app alert when a new
  document, message, or invoice appears. The portal only shows current
  state when a client happens to load a page.

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
├─ firm_id UUID → firms.id                ├─ body_ciphertext BYTEA
├─ kms_key_arn TEXT (null for 'local')    ├─ body_nonce BYTEA
├─ wrapped_dek BYTEA  ← never plaintext   ├─ body_auth_tag BYTEA
├─ status 'active' | 'retired'            └─ encryption_key_id UUID → encryption_keys.id
├─ created_at / retired_at
└─ (partial unique index: at most one
    'active' row per (provider, firm_id))
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

**Concurrency**: two processes can both observe "no active key exists yet
for this firm" and race to mint the first one. A partial unique index
(`idx_one_active_key_per_provider_firm`) makes the loser's insert fail
with a `23505`, at which point it simply re-reads and uses the winner's
key instead of erroring or minting a second active key — the same
re-resolve-on-conflict pattern `CaseService.resolveAndApply` uses for a
concurrent case-creation race.

**Per-firm isolation**: `encryption_keys` is scoped to a firm
(`db/migrations/0008_per_firm_encryption_keys.sql`) — each firm mints,
caches, and rotates its own DEK under the same shared KMS master key
(`KMS_KEY_ARN`), so a key compromise, rotation, or legal hold on one
firm's messages never affects another firm's. Looking a key up by id
(decrypting an existing message) doesn't need a firm check — a key id
already uniquely identifies one key, and every caller that has one only
ever got it from a message row it already proved firm-scoped access to.

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
- **No real third-party e-signature provider is integrated** — the
  request/sign/track workflow itself is real (see "Pluggable e-signature
  workflow" above), running against a self-contained `'local'` provider
  rather than DocuSign/HelloSign/etc. Wiring one of those in is adding a
  new file under `server/services/esignature/providers/`.
- **The staff Dashboard's hearings widget (`case_deadlines`) and
  client-messages widget (`client_messages`) are firm-wide, not
  client-scoped** — those two tables have no per-client ownership column
  in the schema. This doesn't affect the Client Portal (`/portal`, see
  "Client Portal" above), which doesn't use the staff dashboard or these
  two widgets at all — the case and conversation APIs it actually depends
  on ARE fully role-scoped.
- **Client Portal has no account self-service or notifications** — see
  "Client Portal" above for exactly what's covered.
