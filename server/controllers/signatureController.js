const SignatureService = require('../services/signatureService');

/**
 * Signature Controller
 * Staff-authenticated request/list/void endpoints plus two public
 * endpoints the signer hits with no account (getPublicSigningView,
 * completeSigning) — see server/routes/auth.js-style mounting in
 * server/server.js for why those two live outside authMiddleware.
 */

async function requestSignature(req, res, next) {
  try {
    const result = await SignatureService.requestSignature(req.tenantId, req.user, req.body || {});
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function listSignatures(req, res, next) {
  try {
    const { caseId } = req.query;
    const result = caseId
      ? await SignatureService.listForCase(req.tenantId, caseId)
      : await SignatureService.listForFirm(req.tenantId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function listSignaturesForCase(req, res, next) {
  try {
    const result = await SignatureService.listForCase(req.tenantId, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function voidSignature(req, res, next) {
  try {
    const result = await SignatureService.voidRequest(req.tenantId, req.user, req.params.id, req.body ? req.body.reason : null);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function getPublicSigningView(req, res, next) {
  try {
    const result = await SignatureService.getPublicSigningView(req.params.token);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function completeSigning(req, res, next) {
  try {
    const result = await SignatureService.completeSigning(req.params.token, req.body || {}, { ip: req.ip });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requestSignature,
  listSignatures,
  listSignaturesForCase,
  voidSignature,
  getPublicSigningView,
  completeSigning
};
