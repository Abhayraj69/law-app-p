const HearingService = require('../services/hearingService');

/**
 * Hearing Controller
 * Ownership/validation lives in HearingService — see its header comment.
 */

async function listHearings(req, res, next) {
  try {
    const { case_id, status, from_date, to_date } = req.query;
    const hearings = await HearingService.listHearings(req.tenantId, { case_id, status, from_date, to_date });
    res.json({ success: true, data: hearings });
  } catch (err) {
    next(err);
  }
}

async function listHearingsForCase(req, res, next) {
  try {
    const hearings = await HearingService.listHearingsForCase(req.tenantId, req.params.id, req.user);
    res.json({ success: true, data: hearings });
  } catch (err) {
    next(err);
  }
}

async function createHearing(req, res, next) {
  try {
    const hearing = await HearingService.createHearing(req.tenantId, req.user, req.body || {});
    res.status(201).json({ success: true, data: hearing });
  } catch (err) {
    next(err);
  }
}

async function logHearingUpdate(req, res, next) {
  try {
    const hearing = await HearingService.logHearingUpdate(req.tenantId, req.user, req.params.id, req.body || {});
    res.json({ success: true, data: hearing });
  } catch (err) {
    next(err);
  }
}

async function updateHearing(req, res, next) {
  try {
    const hearing = await HearingService.updateHearing(req.tenantId, req.user, req.params.id, req.body || {});
    res.json({ success: true, data: hearing });
  } catch (err) {
    next(err);
  }
}

async function deleteHearing(req, res, next) {
  try {
    const result = await HearingService.deleteHearing(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listHearings,
  listHearingsForCase,
  createHearing,
  logHearingUpdate,
  updateHearing,
  deleteHearing
};
