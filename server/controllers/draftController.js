const DraftService = require('../services/draftService');
const draftTemplates = require('../services/draftTemplates');

/**
 * Draft Controller (Phase 4)
 * Ownership/validation/AI orchestration all live in DraftService — see its
 * header comment. Role floors are applied at the route level
 * (server/routes/api.js), same convention as hearings/tasks/consultations.
 */

async function listTemplates(req, res) {
  res.json({
    success: true,
    data: draftTemplates.VALID_TEMPLATE_KEYS.map(key => ({
      template_key: key,
      label: draftTemplates.getTemplate(key).label,
      sections: draftTemplates.getTemplate(key).sections.map(s => s.heading)
    }))
  });
}

async function generateFromTask(req, res, next) {
  try {
    const draft = await DraftService.generateFromTask(req.tenantId, req.user, req.params.id, req.body || {}, req.log);
    res.status(201).json({ success: true, data: draft });
  } catch (err) {
    next(err);
  }
}

async function getDraft(req, res, next) {
  try {
    const draft = await DraftService.getDraft(req.tenantId, req.params.id, req.user);
    res.json({ success: true, data: draft });
  } catch (err) {
    next(err);
  }
}

async function listDraftsForCase(req, res, next) {
  try {
    const drafts = await DraftService.listDraftsForCase(req.tenantId, req.params.id, req.user);
    res.json({ success: true, data: drafts });
  } catch (err) {
    next(err);
  }
}

async function approveDraft(req, res, next) {
  try {
    const draft = await DraftService.approveDraft(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: draft });
  } catch (err) {
    next(err);
  }
}

async function rejectDraft(req, res, next) {
  try {
    const draft = await DraftService.rejectDraft(req.tenantId, req.user, req.params.id, req.body?.reason);
    res.json({ success: true, data: draft });
  } catch (err) {
    next(err);
  }
}

module.exports = { listTemplates, generateFromTask, getDraft, listDraftsForCase, approveDraft, rejectDraft };
