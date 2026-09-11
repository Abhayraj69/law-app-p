const crypto = require('crypto');
const db = require('../db');
const messageEncryption = require('./encryption/messageEncryptionService');

/**
 * Communications Service
 * Backs the Client Communications page's threaded conversations. Replaces
 * the hardcoded `CONVERSATIONS` array that used to live in app.js — see
 * README.md for the real-vs-mock history.
 *
 * Role scoping and note-visibility both live in server/db.js
 * (scopeConversationsToUser / the `includeNotes` flag on
 * getConversationWithMessages) so there's one place that can get either
 * rule wrong, not one per caller. This service adds a second layer for
 * notes specifically: even if a caller forgot to pass includeNotes=false,
 * `toMessageView` never emits a message whose sender is 'note' unless the
 * caller explicitly says the viewer is staff.
 *
 * Message bodies are encrypted at rest (see server/services/encryption/ and
 * db/migrations/0006_message_encryption.sql) — this service is the only
 * place that ever sees a decrypted body: every view builder here calls
 * messageEncryption.resolveMessageBody, which transparently reads either
 * the encrypted columns or (for a message written before the encryption
 * migration and not yet backfilled) the legacy plaintext `body` column.
 */

function notFound() {
  const err = new Error('Conversation not found.');
  err.status = 404;
  return err;
}

function isStaff(user) {
  return !!user && user.role !== 'CLIENT';
}

// Same relative/absolute split the rest of the app's mock data used:
// a time-of-day for today, "Yesterday" for yesterday, else a short date.
function formatMessageTime(date) {
  const d = new Date(date);
  const now = new Date();
  const isSameDay = d.toDateString() === now.toDateString();
  if (isSameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// `row` carries the last message's fields prefixed with last_message_ (see
// db.listConversationsForUser's LATERAL join) — reshaped here into the
// same {id, conversation_id, body, body_ciphertext, ...} shape
// resolveMessageBody expects, since it's the same underlying row either way.
async function toConversationSummaryView(row) {
  let preview = 'No messages yet';
  if (row.last_message_id) {
    const body = await messageEncryption.resolveMessageBody({
      id: row.last_message_id,
      conversation_id: row.id,
      body: row.last_message_body,
      body_ciphertext: row.last_message_body_ciphertext,
      body_nonce: row.last_message_body_nonce,
      body_auth_tag: row.last_message_body_auth_tag,
      encryption_key_id: row.last_message_encryption_key_id
    });
    preview = row.last_message_sender === 'note' ? `[Note] ${body}` : body;
  }

  return {
    id: row.id,
    caseId: row.case_id,
    caseName: row.case_name,
    clientName: row.client_name,
    status: row.status,
    initials: row.client_initials,
    color: row.client_color,
    unread: row.unread_count,
    preview,
    updatedAt: row.updated_at
  };
}

async function toMessageView(m, viewerIsStaff) {
  const isNote = m.sender === 'note';
  if (isNote && !viewerIsStaff) return null; // defense in depth — see file header

  const body = await messageEncryption.resolveMessageBody(m);
  return {
    id: m.id,
    sender: m.sender,
    senderName: m.sender_name,
    text: isNote ? `STAFF NOTE: ${body}` : body,
    time: formatMessageTime(m.created_at),
    isNote
  };
}

async function toConversationDetailView(conv, viewerIsStaff) {
  const messages = await Promise.all(conv.messages.map(m => toMessageView(m, viewerIsStaff)));
  return {
    id: conv.id,
    caseId: conv.case_id,
    caseName: conv.case_name,
    clientName: conv.client_name,
    status: conv.status,
    initials: conv.client_initials,
    color: conv.client_color,
    messages: messages.filter(Boolean)
  };
}

class CommunicationsService {
  /** GET /api/v1/conversations — role-scoped list for the sidebar. */
  static async listConversations(tenantId, user) {
    const rows = await db.listConversationsForUser(tenantId, user);
    return Promise.all(rows.map(toConversationSummaryView));
  }

  /**
   * GET /api/v1/conversations/:id — full thread. `includeNotes` is derived
   * from the caller's own role, never from a query param, so a CLIENT
   * can't request notes by asking for them.
   */
  static async getConversation(tenantId, conversationId, user) {
    const viewerIsStaff = isStaff(user);
    const conv = await db.getConversationWithMessages(tenantId, conversationId, user, viewerIsStaff);
    if (!conv) throw notFound();
    await db.markConversationRead(conversationId);
    return toConversationDetailView(conv, viewerIsStaff);
  }

  /**
   * POST /api/v1/conversations/:id/messages
   * A CLIENT can only ever post as 'client' and can never post a note —
   * `isNote` from the request body is ignored entirely unless the caller
   * is staff. Ownership is re-verified via getConversationWithMessages
   * (role-scoped) before the insert, so a CLIENT can't message into a
   * conversation that isn't theirs just by guessing its id.
   *
   * The message id is generated here, client-side, BEFORE encryption —
   * not left to the database's default — because the encryption AAD
   * binds ciphertext to a specific (conversation_id, message id) pair,
   * which has to be known before the encrypted bytes are computed, let
   * alone inserted.
   */
  static async postMessage(tenantId, user, conversationId, { text, isNote }) {
    if (!text || !text.trim()) {
      const err = new Error('Message text is required.');
      err.status = 400;
      throw err;
    }

    const viewerIsStaff = isStaff(user);
    const conv = await db.getConversationWithMessages(tenantId, conversationId, user, viewerIsStaff);
    if (!conv) throw notFound();

    const wantsNote = viewerIsStaff && !!isNote;
    const sender = wantsNote ? 'note' : (viewerIsStaff ? 'staff' : 'client');
    const messageId = crypto.randomUUID();

    const { bodyCiphertext, bodyNonce, bodyAuthTag, encryptionKeyId } = await messageEncryption.encryptMessageBody({
      firmId: tenantId,
      conversationId,
      messageId,
      plaintext: text.trim()
    });

    const inserted = await db.insertConversationMessage({
      id: messageId,
      conversationId,
      sender,
      senderUserId: user.id,
      bodyCiphertext,
      bodyNonce,
      bodyAuthTag,
      encryptionKeyId
    });

    return toMessageView({ ...inserted, sender_name: user.full_name }, viewerIsStaff);
  }
}

module.exports = CommunicationsService;
