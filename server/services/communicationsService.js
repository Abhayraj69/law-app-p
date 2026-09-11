const db = require('../db');

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

function toConversationSummaryView(row) {
  let preview = row.last_message_body || 'No messages yet';
  if (row.last_message_sender === 'note') preview = `[Note] ${preview}`;
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

function toMessageView(m, viewerIsStaff) {
  const isNote = m.sender === 'note';
  if (isNote && !viewerIsStaff) return null; // defense in depth — see file header
  return {
    id: m.id,
    sender: m.sender,
    senderName: m.sender_name,
    text: isNote ? `STAFF NOTE: ${m.body}` : m.body,
    time: formatMessageTime(m.created_at),
    isNote
  };
}

function toConversationDetailView(conv, viewerIsStaff) {
  return {
    id: conv.id,
    caseId: conv.case_id,
    caseName: conv.case_name,
    clientName: conv.client_name,
    status: conv.status,
    initials: conv.client_initials,
    color: conv.client_color,
    messages: conv.messages.map(m => toMessageView(m, viewerIsStaff)).filter(Boolean)
  };
}

class CommunicationsService {
  /** GET /api/v1/conversations — role-scoped list for the sidebar. */
  static async listConversations(tenantId, user) {
    const rows = await db.listConversationsForUser(tenantId, user);
    return rows.map(toConversationSummaryView);
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

    const inserted = await db.insertConversationMessage({
      conversationId,
      sender,
      senderUserId: user.id,
      body: text.trim()
    });

    return toMessageView({ ...inserted, sender_name: user.full_name }, viewerIsStaff);
  }
}

module.exports = CommunicationsService;
