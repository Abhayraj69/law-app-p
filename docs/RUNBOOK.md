# SLF Document Vault — Operational Runbook

This is the operational companion to `docs/DEPLOYMENT_TASKS.md`. It exists
because this system holds a firm's client documents, trust ledger and
privileged correspondence — losing any of that, or being unable to restore
it, is a firm-ending event, not an inconvenience.

## 1. Backups

Two independent things must be backed up. The database alone is **not** a
complete backup: uploaded file bytes live on disk (or in the configured
object-storage bucket, once T2 is adopted), outside Postgres entirely.

### 1a. Database

- Run `pg_dump` on a schedule (nightly at minimum; hourly if the firm's risk
  tolerance requires it). A logical dump (`pg_dump -Fc`) is preferred over a
  raw SQL dump because it restores faster and supports selective restore.
- Retain at least 30 days of daily backups, plus at least one dump from each
  of the last 6 months, so a slow-to-notice data-integrity issue can still
  be recovered from.
- Store backups somewhere other than the database host itself — a separate
  region or provider from the primary database, so a single provider outage
  can't take out both the live system and its backups.
- **Test the restore periodically** (quarterly at minimum). A backup that
  has never been restored is a hypothesis, not a backup. See §6.

### 1b. Document storage

- If running a single instance with `STORAGE_ROOT` on a mounted volume
  (T1): back up that volume the same way the database is backed up —
  snapshot on a schedule, retain the same window, store off-host.
- If running multiple instances against object storage (T2,
  `STORAGE_PROVIDER=s3`): enable the bucket's own versioning and
  cross-region replication rather than a separate custom backup job.
- Either way, a restore drill (§6) must prove that a document uploaded
  before the backup was taken can actually be downloaded again afterward —
  not just that the file bytes exist somewhere.

## 2. The one-off message-encryption migration

This is a **manual, human-run** migration, not one of the numbered files
under `db/migrations/` — those run automatically and unattended at boot
under an advisory lock, which is the wrong way to run something
destructive. Run it in this exact order:

```
npm run backfill:encrypt-messages
# Verify it reports 0 remaining plaintext rows before continuing.
```

Only once the backfill reports zero remaining plaintext rows, apply the
manual migration by hand:

```
db/manual-migrations/0007_drop_plaintext_message_body.sql
```

Do not run the drop migration until the backfill has been verified —
dropping the plaintext column before every row has an encrypted
counterpart destroys those messages irrecoverably.

## 3. Log shipping and retention

The app already emits structured JSON logs (see `server/utils/logger.js`),
with a request id carried into every response and correlated in the
corresponding log lines — this runbook does not need to specify a format,
only where those logs go once they leave the process.

- Ship stdout/stderr to a log aggregator (whatever the hosting platform's
  container logging integrates with — CloudWatch, Stackdriver, an ELK/Loki
  stack, etc.). Do not rely on `docker logs`/`kubectl logs` local retention
  alone; those windows are short and reset on redeploy.
- Retain application logs for at least 90 days, given the legal-industry
  context — an incident or dispute may surface well after the fact.
- Never route the seed script's one-time plaintext credential output (see
  `server/db/seed.js`) through the aggregator; it is deliberately raw
  `console.log`, read once by the operator at the terminal, precisely so it
  does not end up sitting in a log store.

## 4. Alerting on health

`/api/v1/health` reports PostgreSQL, ClamAV and KMS reachability
**separately**, not just as one aggregate status. Alert per dependency, not
only on the aggregate `ok`/`degraded` field — a failing ClamAV means
uploads are blocked while everything else keeps working, and that is a
different response than a failing database, which is a full outage.

- Point the load balancer / orchestrator's own health probe at
  `/api/v1/health` (it already has caching suitable for polling).
- Point a separate alerting rule at the same endpoint, evaluating each of
  the three dependency fields, so the on-call engineer's first alert says
  "ClamAV unreachable" rather than a generic "health check failing" that
  has to be triaged by hand.

## 5. Secret rotation

| Secret | Rotation effect | Notes |
|---|---|---|
| `JWT_SECRET` | Invalidates every existing session immediately. | Expected and safe — rotate whenever the secret may have leaked. Warn staff beforehand if this is a planned rotation, since everyone is signed out at once. |
| KMS key (`KMS_KEY_ARN`) | `rotateKey()` retires the old key and mints a new one for future messages. | Retired keys must be **kept forever**, never deleted — messages encrypted under a retired key become permanently unreadable the moment that key is destroyed. Treat retired KMS keys the same as a backup: something whose loss is irreversible. |
| Database credentials | No forced logout; only affects the app's connection to Postgres. | Rotate via the hosting provider's normal credential-rotation flow, then restart instances (or let them pick up the new `DATABASE_URL`/`PGPASSWORD` on next reconnect, depending on the provider). |

## 6. Restore drill

Perform this at least quarterly, and immediately after any change to the
backup or storage configuration.

1. Provision a scratch environment (a throwaway database instance and a
   throwaway storage volume/bucket — never restore into anything that could
   be mistaken for production).
2. Restore the most recent `pg_dump` into the scratch database.
3. Restore the corresponding document storage backup (the volume snapshot,
   or confirm the bucket's replicated objects are readable) into the
   scratch environment.
4. Point a scratch instance of the app at both (`DATABASE_URL` /
   `STORAGE_ROOT` or `STORAGE_PROVIDER=s3` pointed at the scratch bucket).
5. Confirm:
   - The app boots cleanly (all three boot-time checks pass).
   - A document known to exist in the backup window downloads correctly
     and its bytes match the original (compare checksums, not just that a
     download succeeds).
   - A message sent before the backup was taken decrypts correctly (proves
     the KMS key material referenced by encrypted messages is still
     reachable from the restored environment).
6. Record the drill date, what was restored, how long it took end-to-end,
   and anything that didn't work as expected. A restore that "mostly
   worked" is a finding, not a pass — fix the gap before the next drill.
