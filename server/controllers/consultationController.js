const ConsultationService = require('../services/consultationService');

/**
 * Consultation Controller
 * Validation/state rules live in ConsultationService — see its header.
 */

async function listConsultations(req, res, next) {
  try {
    const { status } = req.query;
    const consultations = await ConsultationService.listConsultations(req.tenantId, { status });
    res.json({ success: true, data: consultations });
  } catch (err) {
    next(err);
  }
}

async function getConsultation(req, res, next) {
  try {
    const consultation = await ConsultationService.getConsultation(req.tenantId, req.params.id);
    res.json({ success: true, data: consultation });
  } catch (err) {
    next(err);
  }
}

async function createConsultation(req, res, next) {
  try {
    const consultation = await ConsultationService.createConsultation(req.tenantId, req.user, req.body || {});
    res.status(201).json({ success: true, data: consultation });
  } catch (err) {
    next(err);
  }
}

async function updateConsultation(req, res, next) {
  try {
    const consultation = await ConsultationService.updateConsultation(req.tenantId, req.user, req.params.id, req.body || {});
    res.json({ success: true, data: consultation });
  } catch (err) {
    next(err);
  }
}

async function addDocument(req, res, next) {
  try {
    if (!req.file) throw Object.assign(new Error('No file content received.'), { status: 400 });
    const document = await ConsultationService.addDocument(req.tenantId, req.user, req.params.id, req.file);
    res.status(201).json({ success: true, data: document });
  } catch (err) {
    next(err);
  }
}

async function bundleDocuments(req, res, next) {
  try {
    const result = await ConsultationService.bundleDocuments(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function submitConsultation(req, res, next) {
  try {
    const consultation = await ConsultationService.submitConsultation(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: consultation });
  } catch (err) {
    next(err);
  }
}

async function approveConsultation(req, res, next) {
  try {
    const consultation = await ConsultationService.approveConsultation(req.tenantId, req.user, req.params.id);
    res.json({ success: true, data: consultation });
  } catch (err) {
    next(err);
  }
}

async function declineConsultation(req, res, next) {
  try {
    const consultation = await ConsultationService.declineConsultation(req.tenantId, req.user, req.params.id, (req.body || {}).reason);
    res.json({ success: true, data: consultation });
  } catch (err) {
    next(err);
  }
}

async function convertConsultation(req, res, next) {
  try {
    const result = await ConsultationService.convertConsultation(req.tenantId, req.user, req.params.id, req.body || {});
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function getMatterCategories(req, res, next) {
  try {
    res.json({ success: true, data: ConsultationService.MATTER_CATEGORIES });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listConsultations,
  getConsultation,
  createConsultation,
  updateConsultation,
  addDocument,
  bundleDocuments,
  submitConsultation,
  approveConsultation,
  declineConsultation,
  convertConsultation,
  getMatterCategories
};
