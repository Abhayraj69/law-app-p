const CommunicationsService = require('../services/communicationsService');

/**
 * Communications Controller
 * Maps HTTP request handlers to CommunicationsService. See
 * server/services/communicationsService.js for the role-scoping and
 * note-visibility rules applied to every read/write here.
 */

async function listConversations(req, res, next) {
  try {
    const conversations = await CommunicationsService.listConversations(req.tenantId, req.user);
    res.json({ success: true, data: conversations });
  } catch (err) {
    next(err);
  }
}

async function getConversation(req, res, next) {
  try {
    const conversation = await CommunicationsService.getConversation(req.tenantId, req.params.id, req.user);
    res.json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
}

async function postMessage(req, res, next) {
  try {
    const message = await CommunicationsService.postMessage(req.tenantId, req.user, req.params.id, req.body || {});
    res.status(201).json({ success: true, data: message });
  } catch (err) {
    next(err);
  }
}

module.exports = { listConversations, getConversation, postMessage };
