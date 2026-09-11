const VaultService = require('../services/vaultService');
const FileService = require('../services/fileService');
const IntegrationService = require('../services/integrationService');

/**
 * Vault Controller
 * Maps HTTP request handlers to business services.
 */

// A. Vault Overview & Analytics
async function getStats(req, res, next) {
  try {
    const stats = await VaultService.getStats(req.tenantId);
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

// B. File & Folder Management
async function getTree(req, res, next) {
  try {
    const tree = await VaultService.getFolderTree(req.tenantId);
    res.json({ success: true, data: tree });
  } catch (err) {
    next(err);
  }
}

async function getFiles(req, res, next) {
  try {
    const result = await VaultService.getFiles(req.tenantId, req.query, req.user);
    res.json({ success: true, data: result.documents, pagination: result.pagination });
  } catch (err) {
    next(err);
  }
}

async function createFolder(req, res, next) {
  try {
    const folder = await VaultService.createFolder(req.tenantId, req.user.id, req.body);
    res.status(201).json({ success: true, data: folder });
  } catch (err) {
    next(err);
  }
}

async function uploadFile(req, res, next) {
  try {
    const result = await VaultService.initiateUpload(req.tenantId, req.user.id, req.file, req.body);
    res.status(201).json({
      success: true,
      data: { ...result, upload_validation: req.uploadValidation || null }
    });
  } catch (err) {
    next(err);
  }
}

// C. File Operations (Row Actions)
async function getPreview(req, res, next) {
  try {
    const preview = await FileService.getPreview(req.tenantId, req.params.id, req.user);
    res.json({ success: true, data: preview });
  } catch (err) {
    next(err);
  }
}

async function downloadFile(req, res, next) {
  try {
    const download = await FileService.getDownloadStream(req.tenantId, req.params.id, req.user);
    res.setHeader('Content-Type', download.headers['Content-Type']);
    res.setHeader('Content-Disposition', download.headers['Content-Disposition']);
    res.setHeader('Content-Length', download.headers['Content-Length']);
    download.stream.on('error', next);
    download.stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

async function shareFile(req, res, next) {
  try {
    const share = await FileService.createShareLink(req.tenantId, req.user.id, req.params.id, req.body);
    res.status(201).json({ success: true, data: share });
  } catch (err) {
    next(err);
  }
}

async function patchFile(req, res, next) {
  try {
    const updated = await FileService.patchDocument(req.tenantId, req.params.id, req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function deleteFile(req, res, next) {
  try {
    const result = await FileService.deleteDocument(req.tenantId, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// D. Widgets & Integrations
async function getQuickAccess(req, res, next) {
  try {
    const data = await IntegrationService.getQuickAccess(req.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getFlaggedMessages(req, res, next) {
  try {
    const messages = await IntegrationService.getFlaggedMessages(req.tenantId);
    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  }
}

async function getDeadlines(req, res, next) {
  try {
    const deadlines = await IntegrationService.getDeadlines(req.tenantId);
    res.json({ success: true, data: deadlines });
  } catch (err) {
    next(err);
  }
}

async function getSidebarWidgets(req, res, next) {
  try {
    const [deadlinesData, quickAccess, messages] = await Promise.all([
      IntegrationService.getDeadlines(req.tenantId),
      IntegrationService.getQuickAccess(req.tenantId),
      IntegrationService.getFlaggedMessages(req.tenantId)
    ]);
    res.json({
      success: true,
      data: {
        deadlines: deadlinesData.upcoming || [],
        quick_access: quickAccess,
        client_messages: messages
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStats,
  getTree,
  getFiles,
  createFolder,
  uploadFile,
  getPreview,
  downloadFile,
  shareFile,
  patchFile,
  deleteFile,
  getQuickAccess,
  getFlaggedMessages,
  getDeadlines,
  getSidebarWidgets
};
