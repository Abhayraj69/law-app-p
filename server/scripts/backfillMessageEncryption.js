require('../env');

const { pool } = require('../db/pool');
const messageEncryption = require('../services/encryption/messageEncryptionService');

/**
 * Backfill Script — encrypts every pre-existing plaintext
 * conversation_messages row (npm run backfill:encrypt-messages).
 *
 * Step 3 of the message-encryption migration plan (see the header of
 * db/migrations/0006_message_encryption.sql for the full runbook). Run
 * this ONCE per environment/database, any time after 0006 has been
 * applied and the application is deployed with encryption-aware code —
 * it never needs to run again except to pick up rows that somehow still
 * have a plaintext body (which shouldn't happen post-cutover, since
 * every new write goes straight to the encrypted columns).
 *
 * Safe to re-run: each pass only selects rows where body_ciphertext IS
 * NULL, so an interrupted run (crash, Ctrl+C, a deploy in the middle) can
 * simply be started again and it picks up exactly where it left off —
 * nothing is double-encrypted, nothing is skipped.
 *
 * Deliberately NOT run automatically at server boot, unlike schema
 * migrations (server/db/migrate.js) — this touches every row of
 * plaintext message content in the table and its pace/cost should be
 * visible and controllable by whoever runs it, not silently kicked off
 * by a process restart.
 */

const BATCH_SIZE = parseInt(process.env.BACKFILL_BATCH_SIZE, 10) || 200;

async function backfill() {
  console.log(`[BACKFILL] Encrypting plaintext conversation_messages rows in batches of ${BATCH_SIZE}...`);

  let totalEncrypted = 0;
  let batchCount;
  do {
    // Each batch runs in its own transaction (FOR UPDATE needs one) so a
    // failure partway through doesn't lose progress on batches already
    // committed, and the row-lock from FOR UPDATE is held only as long as
    // this one batch takes, not the whole run.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      batchCount = await backfillBatchWithClient(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    totalEncrypted += batchCount;
    if (batchCount > 0) {
      console.log(`[BACKFILL] Encrypted ${batchCount} message(s) this batch (${totalEncrypted} total so far)...`);
    }
  } while (batchCount === BATCH_SIZE); // a short/empty batch means we've drained the table

  const { rows: remaining } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM conversation_messages WHERE body IS NOT NULL AND body_ciphertext IS NULL`
  );

  console.log(`[BACKFILL] Done. ${totalEncrypted} message(s) encrypted this run.`);
  console.log(`[BACKFILL] ${remaining[0].n} plaintext rows remaining.`);
  if (remaining[0].n === 0) {
    console.log('[BACKFILL] All messages are encrypted. Once you are confident there is no need to keep the ' +
      'plaintext body column, run db/manual-migrations/0007_drop_plaintext_message_body.sql by hand — see that ' +
      "file's own checklist first.");
  } else {
    console.log('[BACKFILL] Re-run this script to continue (rows may remain if they were locked by another ' +
      'process, or if BACKFILL_BATCH_SIZE was reached mid-table and another pass is needed).');
  }
}

// pool.connect() gives its own client, separate from the module-level
// pool.query() calls elsewhere — needed so BEGIN/COMMIT/FOR UPDATE all
// happen on the same underlying connection.
//
// FOR UPDATE SKIP LOCKED: if this script is ever accidentally run twice
// concurrently (or alongside some other process touching these rows),
// each instance grabs a distinct batch instead of both racing to encrypt
// (and both trying to UPDATE) the same rows.
async function backfillBatchWithClient(client) {
  const { rows } = await client.query(
    `SELECT id, conversation_id, body FROM conversation_messages
     WHERE body IS NOT NULL AND body_ciphertext IS NULL
     ORDER BY created_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [BATCH_SIZE]
  );

  for (const row of rows) {
    const { bodyCiphertext, bodyNonce, bodyAuthTag, encryptionKeyId } = await messageEncryption.encryptMessageBody({
      conversationId: row.conversation_id,
      messageId: row.id,
      plaintext: row.body
    });

    await client.query(
      `UPDATE conversation_messages
       SET body_ciphertext = $1, body_nonce = $2, body_auth_tag = $3, encryption_key_id = $4, body = NULL
       WHERE id = $5`,
      [bodyCiphertext, bodyNonce, bodyAuthTag, encryptionKeyId, row.id]
    );
  }

  return rows.length;
}

module.exports = { backfill };

if (require.main === module) {
  backfill()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[BACKFILL] Failed:', err.message);
      pool.end().finally(() => process.exit(1));
    });
}
