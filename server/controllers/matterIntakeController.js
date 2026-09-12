const MatterIntakeService = require('../services/matterIntakeService');

/**
 * Matter Intake Controller
 * Maps HTTP handlers to MatterIntakeService. Role floors are set on the
 * routes in server/routes/api.js — conflict-override, retainer-waiver,
 * and activate are all PARTNER+; everything else is ASSOCIATE+, matching
 * the existing case-write floor (PATCH /api/v1/cases/:id/archive).
 */

async function startIntake(req, res, next) {
  try {
    const intake = await MatterIntakeService.startIntake(req.tenantId, req.user, req.body);
    res.status(201).json({ success: true, data: intake });
  } catch (err) {
    next(err);
  }
}

async function getIntake(req, res, next) {
  try {
    const intake = await MatterIntakeService.getIntake(req.tenantId, req.params.id);
    res.json({ success: true, data: intake });
  } catch (err) {
    next(err);
  }
}

async function overrideConflictHold(req, res, next) {
  try {
    const intake = await MatterIntakeService.overrideConflictHold(req.tenantId, req.user, req.params.id, req.body?.reason);
    res.json({ success: true, data: intake });
  } catch (err) {
    next(err);
  }
}

async function attachEngagementLetter(req, res, next) {
  try {
    if (!req.file) throw Object.assign(new Error('No file content received.'), { status: 400 });
    const intake = await MatterIntakeService.attachEngagementLetter(req.tenantId, req.user, req.params.id, req.file);
    res.status(201).json({ success: true, data: intake });
  } catch (err) {
    next(err);
  }
}

async function markEngagementLetterSent(req, res, next) {
  try {
    const intake = await MatterIntakeService.markEngagementLetterSent(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: intake });
  } catch (err) {
    next(err);
  }
}

async function attachSignedDocument(req, res, next) {
  try {
    if (!req.file) throw Object.assign(new Error('No file content received.'), { status: 400 });
    const intake = await MatterIntakeService.attachSignedDocument(req.tenantId, req.user, req.params.id, req.file);
    res.status(201).json({ success: true, data: intake });
  } catch (err) {
    next(err);
  }
}

async function linkRetainer(req, res, next) {
  try {
    const intake = await MatterIntakeService.linkRetainer(req.tenantId, req.user, req.params.id, req.body);
    res.status(201).json({ success: true, data: intake });
  } catch (err) {
    next(err);
  }
}

async function waiveRetainer(req, res, next) {
  try {
    const intake = await MatterIntakeService.waiveRetainer(req.tenantId, req.user, req.params.id, req.body?.reason);
    res.json({ success: true, data: intake });
  } catch (err) {
    next(err);
  }
}

async function activate(req, res, next) {
  try {
    const intake = await MatterIntakeService.activate(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: intake });
  } catch (err) {
    next(err);
  }
}

async function decline(req, res, next) {
  try {
    const intake = await MatterIntakeService.decline(req.tenantId, req.user, req.params.id, req.body?.reason);
    res.json({ success: true, data: intake });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  startIntake,
  getIntake,
  overrideConflictHold,
  attachEngagementLetter,
  markEngagementLetterSent,
  attachSignedDocument,
  linkRetainer,
  waiveRetainer,
  activate,
  decline
};
