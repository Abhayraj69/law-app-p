const db = require('../db');

/**
 * Integration & Widget Service
 * Provides quick access items, client messages with critical attachments, and upcoming hearing deadlines.
 */

class IntegrationService {
  /**
   * GET /api/v1/vault/quick-access
   * Returns recently accessed documents and frequently used folders
   */
  static async getQuickAccess(tenantId) {
    const allDocs = await db.listActiveDocuments(tenantId);
    const allFolders = await db.listFolders(tenantId);

    // Sort by most recent activity (updated_at)
    const recentDocs = [...allDocs]
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, 5)
      .map(d => ({
        id: d.id,
        file_name: d.file_name,
        extension: d.extension,
        case_name: d.case_name,
        case_id: d.case_id,
        file_size_bytes: Number(d.file_size_bytes),
        author_name: d.author_name,
        updated_at: d.updated_at
      }));

    // Get folders with most documents
    const folderCounts = {};
    allDocs.forEach(d => {
      if (d.folder_id) {
        folderCounts[d.folder_id] = (folderCounts[d.folder_id] || 0) + 1;
      }
    });

    const frequentFolders = allFolders
      .map(f => ({
        id: f.id,
        folder_name: f.folder_name,
        category: f.category,
        document_count: folderCounts[f.id] || 0
      }))
      .sort((a, b) => b.document_count - a.document_count)
      .slice(0, 3);

    return {
      recent_files: recentDocs,
      frequent_folders: frequentFolders
    };
  }

  /**
   * GET /api/v1/vault/flagged-messages
   * Returns client messages with unread count and preview
   */
  static async getFlaggedMessages(tenantId) {
    const messages = await db.listClientMessages(tenantId);

    return messages.map(m => ({
      id: m.id,
      client_name: m.client_name,
      client_avatar: m.client_avatar,
      subject: m.subject,
      preview: m.preview,
      timestamp_text: m.timestamp_text,
      is_unread: m.is_unread,
      is_urgent: m.is_urgent,
      attachment_name: m.attachment_name,
      attachment_size: m.attachment_size,
      attachment_doc_id: m.attachment_doc_id
    }));
  }

  /**
   * GET /api/v1/vault/deadlines
   * Returns upcoming hearings and deadlines (top 5)
   */
  static async getDeadlines(tenantId) {
    const deadlines = await db.listCaseDeadlines(tenantId);
    const sorted = deadlines.slice(0, 5);

    // Group by month for calendar display
    const calendarEvents = {};
    sorted.forEach(d => {
      const date = new Date(d.deadline_date);
      const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!calendarEvents[monthYear]) {
        calendarEvents[monthYear] = [];
      }
      calendarEvents[monthYear].push(d);
    });

    return {
      upcoming: sorted,
      calendar_events: calendarEvents,
      total_upcoming: deadlines.length
    };
  }
}

module.exports = IntegrationService;
