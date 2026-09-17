const crypto = require('crypto');
const db = require('../db');
const { getSignatureProvider } = require('./esignature/providerSelector');
const MatterIntakeService = require('./matterIntakeService');

/**
 * Signature Service
 *
 * Backs a real e-signature request/status-tracking workflow — replacing
 * the Communications composer's disabled "Request Signature" button (see
 * README's former "What's still mock/static" entry). A request is sent
 * through a pluggable provider (server/services/esignature/, 'local' by
 * default — see providerSelector.js); the signer completes it on a public,
 * unauthenticated page (`/sign-document.html?token=...`) reached via a
 * one-time link, the exact same shape as the admin-invite flow
 * (server/services/inviteService.js) — only the SHA-256 hash of the raw
 * token is ever stored (signature_requests.token_hash).
 *
 * A request optionally carries a case_id; if that case's Matter Intake is
 * waiting in ENGAGEMENT_LETTER_SENT when the signer completes it, the
 * intake auto-advances to SIGNED using this same document (see
 * MatterIntakeService.markSignedViaSignatureRequest) — the drop-in this
 * app's own migration 0015 comment anticipated.
 */

const REQUEST_TTL_DAYS = 14;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function notFound() {
  const err = new Error('Signature request not found.');
  err.status = 404;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function invalidOrExpiredError() {
  const err = new Error('This signing link is invalid, expired, or has already been used.');
  err.status = 404;
  return err;
}

function toView(row) {
  return {
    id: row.id,
    case_id: row.case_id,
    case_name: row.case_name,
    document_id: row.document_id,
    document_name: row.document_original_name,
    requested_by_name: row.requested_by_name,
    signer_name: row.signer_name,
    signer_email: row.signer_email,
    provider: row.provider,
    status: row.status,
    requested_at: row.requested_at,
    completed_at: row.completed_at,
    voided_at: row.voided_at,
    voided_reason: row.voided_reason,
    expires_at: row.expires_at,
    signed_document_id: row.signed_document_id
  };
}

class SignatureService {
  /**
   * POST /api/v1/signatures (staff, ASSOCIATE+)
   * `caseId` is optional — a request can target any document the caller
   * can already see; when a caseId IS given it's validated against the
   * firm (unscoped by CLIENT ownership, since this is a staff-only write,
   * same posture InvoiceService uses for its own optional case_id).
   */
  static async requestSignature(tenantId, actingUser, { caseId, documentId, signerName, signerEmail }) {
    if (!documentId) throw badRequest('documentId is required.');
    if (!signerName || !signerName.trim() || !signerEmail || !signerEmail.trim()) {
      throw badRequest('signerName and signerEmail are required.');
    }

    const document = await db.getDocumentById(tenantId, documentId, actingUser);
    if (!document) throw badRequest('Document not found.', 'DOCUMENT_NOT_FOUND');

    if (caseId) {
      const caseRow = await db.getCaseByIdForUser(tenantId, caseId, null);
      if (!caseRow) throw badRequest('Case not found.', 'CASE_NOT_FOUND');
    }

    const provider = getSignatureProvider();
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000);

    const inserted = await db.insertSignatureRequest({
      firmId: tenantId,
      caseId: caseId || null,
      documentId,
      requestedBy: actingUser.id,
      signerName: signerName.trim(),
      signerEmail: signerEmail.trim(),
      provider: provider.name,
      tokenHash: hashToken(rawToken),
      expiresAt
    });

    await provider.send(inserted);

    await db.insertSignatureRequestEvent({ signatureRequestId: inserted.id, eventType: 'SENT', actorId: actingUser.id });
    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'CREATE_SIGNATURE_REQUEST',
      details: { signature_request_id: inserted.id, document_id: documentId, case_id: caseId || null }
    });

    const full = await db.getSignatureRequestById(tenantId, inserted.id);
    return { ...toView(full), sign_path: `/sign-document.html?token=${rawToken}` };
  }

  /** GET /api/v1/signatures?caseId=... or GET /api/v1/cases/:id/signatures */
  static async listForCase(tenantId, caseId) {
    const rows = await db.listSignatureRequestsByCase(tenantId, caseId);
    return rows.map(toView);
  }

  /** GET /api/v1/signatures — firm-wide list. */
  static async listForFirm(tenantId) {
    const rows = await db.listSignatureRequestsByFirm(tenantId);
    return rows.map(toView);
  }

  /** POST /api/v1/signatures/:id/void (staff, ASSOCIATE+) */
  static async voidRequest(tenantId, actingUser, requestId, reason) {
    const row = await db.getSignatureRequestById(tenantId, requestId);
    if (!row) throw notFound();
    if (row.status !== 'sent') {
      throw badRequest(`Cannot void a request that is already ${row.status}.`, 'INVALID_STATE');
    }

    const updated = await db.updateSignatureRequestStatus(tenantId, requestId, {
      status: 'voided', voidedAt: new Date(), voidedReason: reason || null
    });
    if (!updated) throw badRequest('This request was already completed or voided.', 'INVALID_STATE');

    await db.insertSignatureRequestEvent({ signatureRequestId: requestId, eventType: 'VOIDED', actorId: actingUser.id, note: reason || null });
    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'VOID_SIGNATURE_REQUEST',
      details: { signature_request_id: requestId }
    });

    const full = await db.getSignatureRequestById(tenantId, requestId);
    return toView(full);
  }

  /**
   * GET /api/v1/sign/:token (public, no auth) — what the signer sees
   * before signing. Deliberately a small subset of the full view (no
   * internal ids, no requester name) — this page is reachable by anyone
   * holding the link.
   */
  static async getPublicSigningView(rawToken) {
    const row = await db.getUsableSignatureRequestByTokenHash(hashToken(rawToken));
    if (!row) throw invalidOrExpiredError();
    return {
      signer_name: row.signer_name,
      document_name: row.document_original_name,
      case_name: row.case_name,
      firm_name: row.firm_name,
      expires_at: row.expires_at
    };
  }

  /**
   * POST /api/v1/sign/:token/complete (public, no auth) — the signer's own
   * action. `typedName` is the signature itself (typed-name signing, the
   * same mechanism most real e-signature providers offer alongside drawn
   * signatures) — recorded as signer_typed_name/signer_ip/completed_at on
   * the row, never used to alter the underlying document.
   */
  static async completeSigning(rawToken, { typedName }, requestMeta = {}) {
    if (!typedName || !typedName.trim()) throw badRequest('Type your full name to sign.');

    const row = await db.getUsableSignatureRequestByTokenHash(hashToken(rawToken));
    if (!row) throw invalidOrExpiredError();

    const updated = await db.completeSignatureRequest(row.id, {
      signerTypedName: typedName.trim(),
      signerIp: requestMeta.ip || null,
      signedDocumentId: row.document_id
    });
    if (!updated) throw invalidOrExpiredError(); // lost a race to a concurrent submit of the same link

    await db.insertSignatureRequestEvent({
      signatureRequestId: row.id, eventType: 'SIGNED', actorId: null, note: `Signed by ${typedName.trim()}`
    });
    await db.insertAuditLog({
      firmId: row.firm_id, userId: row.requested_by, action: 'COMPLETE_SIGNATURE_REQUEST',
      details: { signature_request_id: row.id, document_id: row.document_id }
    });

    if (row.case_id) {
      // Not every signature request is tied to an in-progress intake —
      // markSignedViaSignatureRequest already no-ops for any state other
      // than ENGAGEMENT_LETTER_SENT, so nothing further to guard here.
      await MatterIntakeService.markSignedViaSignatureRequest(row.firm_id, row.case_id, row.document_id, row.requested_by);
    }

    const full = await db.getSignatureRequestById(row.firm_id, row.id);
    return toView(full);
  }
}

module.exports = SignatureService;
