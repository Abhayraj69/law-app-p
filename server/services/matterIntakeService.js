const db = require('../db');
const VaultService = require('./vaultService');
const TrustService = require('./trustService');
const ConflictCheckService = require('./conflictCheckService');
const CaseService = require('./caseService');

/**
 * Matter-Opening Workflow (Case Intake)
 *
 * A case created through CaseService.createCase has always gone straight
 * to status='active' with nothing in between but a one-shot conflict
 * check the same request could immediately override (see
 * CaseService.createCase's own comment). This service is a deliberately
 * SEPARATE, opt-in path: "Start Matter Intake" creates the case in
 * status='pending' and walks it through
 *   CONFLICT_PENDING -> (CONFLICT_HOLD -> CONFLICT_CLEARED) ->
 *   ENGAGEMENT_LETTER_DRAFTED -> ENGAGEMENT_LETTER_SENT -> SIGNED ->
 *   RETAINER_RECEIVED -> ACTIVATED
 * before CaseService-level code is allowed to call activate() and flip
 * the case to 'active'. The existing quick "New Case" button/API is left
 * exactly as it worked before — this does not retroactively gate any
 * pre-existing case, only ones opened through this flow (see migration
 * 0015's header comment on why a case with no case_intake row is simply
 * outside this workflow).
 *
 * Every transition is written to case_intake_events (an append-only
 * transition log — never updated or deleted, same posture as
 * trust_transactions) AND to the firm's audit_logs, the same
 * belt-and-suspenders TrustService uses for its own domain ledger vs.
 * audit trail.
 */

const TERMINAL_ORDER = [
  'CONFLICT_PENDING', 'CONFLICT_HOLD', 'CONFLICT_CLEARED',
  'ENGAGEMENT_LETTER_DRAFTED', 'ENGAGEMENT_LETTER_SENT', 'SIGNED',
  'RETAINER_RECEIVED', 'ACTIVATED'
];

function notFound(what) {
  const err = new Error(`${what} not found.`);
  err.status = 404;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function wrongState(intake, expected) {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const err = new Error(
    `This action requires the matter intake to be in state ${expectedList.join(' or ')}, but it is currently ${intake.state}.`
  );
  err.status = 409;
  err.code = 'INTAKE_STATE_MISMATCH';
  err.current_state = intake.state;
  err.expected_state = expectedList;
  throw err;
}

function requireMemo(memo) {
  if (!memo || !String(memo).trim()) throw badRequest('A memo/reason is required for this step.');
  return String(memo).trim();
}

async function assertIntake(tenantId, caseId) {
  const intake = await db.getCaseIntake(tenantId, caseId);
  if (!intake) throw notFound('Matter intake');
  return intake;
}

async function transition(tenantId, actingUser, intake, toState, updates, auditAction, auditDetails, note) {
  const updated = await db.updateCaseIntake(tenantId, intake.case_id, { state: toState, ...updates });
  await db.insertCaseIntakeEvent({
    caseId: intake.case_id, fromState: intake.state, toState,
    actorId: actingUser.id, note: note || null
  });
  await db.insertAuditLog({
    firmId: tenantId, userId: actingUser.id, action: auditAction,
    details: { case_id: intake.case_id, ...auditDetails }
  });
  return toIntakeView(updated);
}

function toIntakeView(intake, events) {
  return {
    case_id: intake.case_id,
    state: intake.state,
    conflict_check_matches: intake.conflict_check_matches || [],
    conflict_override_by: intake.conflict_override_by,
    conflict_override_reason: intake.conflict_override_reason,
    engagement_letter_document_id: intake.engagement_letter_document_id,
    engagement_letter_sent_at: intake.engagement_letter_sent_at,
    signed_document_id: intake.signed_document_id,
    signed_at: intake.signed_at,
    retainer_transaction_id: intake.retainer_transaction_id,
    retainer_waived: intake.retainer_waived,
    retainer_waived_reason: intake.retainer_waived_reason,
    activated_at: intake.activated_at,
    declined_at: intake.declined_at,
    declined_reason: intake.declined_reason,
    checklist: {
      conflict_cleared: TERMINAL_ORDER.indexOf(intake.state) >= TERMINAL_ORDER.indexOf('CONFLICT_CLEARED') && intake.state !== 'CONFLICT_HOLD',
      engagement_letter_drafted: TERMINAL_ORDER.indexOf(intake.state) >= TERMINAL_ORDER.indexOf('ENGAGEMENT_LETTER_DRAFTED'),
      engagement_letter_sent: TERMINAL_ORDER.indexOf(intake.state) >= TERMINAL_ORDER.indexOf('ENGAGEMENT_LETTER_SENT'),
      signed: TERMINAL_ORDER.indexOf(intake.state) >= TERMINAL_ORDER.indexOf('SIGNED'),
      retainer_settled: TERMINAL_ORDER.indexOf(intake.state) >= TERMINAL_ORDER.indexOf('RETAINER_RECEIVED'),
      activated: intake.state === 'ACTIVATED'
    },
    events: (events || []).map(e => ({
      from_state: e.from_state, to_state: e.to_state, actor_name: e.actor_name, note: e.note, created_at: e.created_at
    }))
  };
}

class MatterIntakeService {
  /**
   * POST /api/v1/cases/intake — creates the case AND its intake row
   * together. Unlike CaseService.createCase, this never defaults to
   * status='active' and never accepts a conflictOverride shortcut in the
   * same call — a conflict hit here always lands in CONFLICT_HOLD and
   * must be cleared as its own separate, PARTNER-gated step (see
   * overrideConflictHold below). Reuses CaseService only for id
   * generation / attorney resolution, not for its own create-time
   * conflict-override path.
   */
  static async startIntake(tenantId, actingUser, payload = {}) {
    const { title, client, opposingParty, opposingCounsel, area, attorney, description, relatedEntities } = payload;

    if (!title || !title.trim() || !client || !client.trim()) {
      throw badRequest('Case title and client name are required.');
    }

    const cleanRelatedEntities = Array.isArray(relatedEntities)
      ? relatedEntities.map(e => (e || '').trim()).filter(Boolean)
      : [];

    const matchedAttorney = await CaseService.resolveAttorneyByShorthand(tenantId, attorney);
    const year = new Date().getFullYear();
    const maxNum = await db.getMaxCaseNumber(tenantId);
    const id = `LC-${year}-${String(maxNum + 1).padStart(3, '0')}`;

    const { matches } = await ConflictCheckService.checkConflicts(tenantId, {
      client: client.trim(),
      opposingParty: opposingParty || null,
      opposingCounsel: opposingCounsel || null,
      relatedEntities: cleanRelatedEntities
    });

    // Always 'pending' — activation only ever happens via activate() below,
    // never as a side effect of intake start, regardless of conflict result.
    await db.insertCase({
      id, firmId: tenantId, caseName: title.trim(), clientName: client.trim(),
      opposingParty: opposingParty || null, opposingCounsel: opposingCounsel || null,
      status: 'pending', leadAttorneyId: matchedAttorney ? matchedAttorney.id : null,
      caseType: area || null, description: description || null, relatedEntities: cleanRelatedEntities
    });

    const initialState = matches.length ? 'CONFLICT_HOLD' : 'CONFLICT_CLEARED';
    const intake = await db.insertCaseIntake({ caseId: id, firmId: tenantId, state: initialState, conflictMatches: matches });
    await db.insertCaseIntakeEvent({ caseId: id, fromState: null, toState: initialState, actorId: actingUser.id });

    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'CASE_INTAKE_STARTED',
      details: { case_id: id, case_name: title.trim() }
    });
    if (matches.length) {
      await db.insertAuditLog({
        firmId: tenantId, userId: actingUser.id, action: 'CASE_INTAKE_CONFLICT_HOLD',
        details: { case_id: id, case_name: title.trim(), matches }
      });
    }

    return toIntakeView(intake);
  }

  /** GET /api/v1/cases/:id/intake */
  static async getIntake(tenantId, caseId) {
    const intake = await assertIntake(tenantId, caseId);
    const events = await db.listCaseIntakeEvents(caseId);
    return toIntakeView(intake, events);
  }

  /**
   * POST /api/v1/cases/:id/intake/conflict-override — the ONLY way past a
   * CONFLICT_HOLD. Deliberately its own PARTNER-gated call (enforced at
   * the route), not a flag on any other request — see this file's header
   * comment on why that matters.
   */
  static async overrideConflictHold(tenantId, actingUser, caseId, reason) {
    const intake = await assertIntake(tenantId, caseId);
    if (intake.state !== 'CONFLICT_HOLD') wrongState(intake, 'CONFLICT_HOLD');
    const validatedReason = requireMemo(reason);

    return transition(tenantId, actingUser, intake, 'CONFLICT_CLEARED',
      { conflictOverrideBy: actingUser.id, conflictOverrideReason: validatedReason },
      'CASE_INTAKE_CONFLICT_OVERRIDE', { reason: validatedReason });
  }

  /**
   * POST /api/v1/cases/:id/intake/engagement-letter — staff uploads the
   * drafted engagement letter as a real vault document tied to this case.
   */
  static async attachEngagementLetter(tenantId, actingUser, caseId, file) {
    const intake = await assertIntake(tenantId, caseId);
    if (intake.state !== 'CONFLICT_CLEARED') wrongState(intake, 'CONFLICT_CLEARED');

    const { document } = await VaultService.initiateUpload(tenantId, actingUser.id, file, {
      case_id: caseId, tags: ['Engagement Letter']
    });

    return transition(tenantId, actingUser, intake, 'ENGAGEMENT_LETTER_DRAFTED',
      { engagementLetterDocumentId: document.id },
      'CASE_INTAKE_ENGAGEMENT_LETTER_UPLOADED', { document_id: document.id });
  }

  /** POST /api/v1/cases/:id/intake/engagement-letter/sent */
  static async markEngagementLetterSent(tenantId, actingUser, caseId) {
    const intake = await assertIntake(tenantId, caseId);
    if (intake.state !== 'ENGAGEMENT_LETTER_DRAFTED') wrongState(intake, 'ENGAGEMENT_LETTER_DRAFTED');

    return transition(tenantId, actingUser, intake, 'ENGAGEMENT_LETTER_SENT',
      { engagementLetterSentAt: new Date() },
      'CASE_INTAKE_ENGAGEMENT_LETTER_SENT', {});
  }

  /**
   * POST /api/v1/cases/:id/intake/signed — staff manually uploads the
   * countersigned copy, same as attachEngagementLetter. The alternative
   * path — a client completing a real e-signature request tied to this
   * case — is markSignedViaSignatureRequest below, called from
   * SignatureService.completeSigning instead of this route.
   */
  static async attachSignedDocument(tenantId, actingUser, caseId, file) {
    const intake = await assertIntake(tenantId, caseId);
    if (intake.state !== 'ENGAGEMENT_LETTER_SENT') wrongState(intake, 'ENGAGEMENT_LETTER_SENT');

    const { document } = await VaultService.initiateUpload(tenantId, actingUser.id, file, {
      case_id: caseId, tags: ['Signed Engagement Letter']
    });

    return transition(tenantId, actingUser, intake, 'SIGNED',
      { signedDocumentId: document.id, signedAt: new Date() },
      'CASE_INTAKE_SIGNED', { document_id: document.id });
  }

  /**
   * Called by SignatureService.completeSigning when a completed signature
   * request is tied to a case (signature_requests.case_id) — if that
   * case's intake is waiting on ENGAGEMENT_LETTER_SENT, this advances it
   * to SIGNED using the just-signed document, exactly like
   * attachSignedDocument above but driven by the signer's own action
   * instead of a staff upload. Any other intake state (no intake row at
   * all, already SIGNED, still drafting the letter, etc.) is silently a
   * no-op — a signature request isn't required to be tied to an
   * in-progress intake at all, so this must never throw for callers that
   * aren't in the one state it applies to.
   */
  static async markSignedViaSignatureRequest(tenantId, caseId, documentId, actorId) {
    const intake = await db.getCaseIntake(tenantId, caseId);
    if (!intake || intake.state !== 'ENGAGEMENT_LETTER_SENT') return null;

    return transition(tenantId, { id: actorId || null }, intake, 'SIGNED',
      { signedDocumentId: documentId, signedAt: new Date() },
      'CASE_INTAKE_SIGNED', { document_id: documentId, via: 'signature_request' });
  }

  /**
   * POST /api/v1/cases/:id/intake/retainer — records (or reuses) a real
   * trust deposit via TrustService and links it here. `client_ledger_id`
   * is required — the matter intake screen is expected to offer "use
   * existing client ledger" or "open a new one" (TrustService.
   * createClientLedger) before calling this, same as the Trust Accounting
   * page's own flow.
   */
  static async linkRetainer(tenantId, actingUser, caseId, payload = {}) {
    const intake = await assertIntake(tenantId, caseId);
    if (intake.state !== 'SIGNED') wrongState(intake, 'SIGNED');

    const { client_ledger_id, amount_cents, memo } = payload;
    if (!client_ledger_id) throw badRequest('client_ledger_id is required.');

    const deposit = await TrustService.recordDeposit(tenantId, actingUser, {
      client_ledger_id, amount_cents, memo: memo || `Retainer for ${caseId}`, case_id: caseId
    });

    return transition(tenantId, actingUser, intake, 'RETAINER_RECEIVED',
      { retainerTransactionId: deposit.id },
      'CASE_INTAKE_RETAINER_LINKED', { transaction_id: deposit.id, amount_cents: deposit.amount_cents });
  }

  /**
   * POST /api/v1/cases/:id/intake/retainer/waive — for matters with no
   * retainer (contingency, pro bono). PARTNER-gated at the route, same
   * override posture as overrideConflictHold above.
   */
  static async waiveRetainer(tenantId, actingUser, caseId, reason) {
    const intake = await assertIntake(tenantId, caseId);
    if (intake.state !== 'SIGNED') wrongState(intake, 'SIGNED');
    const validatedReason = requireMemo(reason);

    return transition(tenantId, actingUser, intake, 'RETAINER_RECEIVED',
      { retainerWaived: true, retainerWaivedReason: validatedReason },
      'CASE_INTAKE_RETAINER_WAIVED', { reason: validatedReason });
  }

  /**
   * POST /api/v1/cases/:id/intake/activate — the hard gate: refuses
   * unless case_intake.state is exactly RETAINER_RECEIVED (i.e. every
   * prior step, or its explicit override/waiver, has already happened).
   * db.activateCaseIntake flips case_intake.state and cases.status
   * together in one transaction so they can never disagree.
   */
  static async activate(tenantId, actingUser, caseId) {
    const intake = await assertIntake(tenantId, caseId);
    if (intake.state !== 'RETAINER_RECEIVED') wrongState(intake, 'RETAINER_RECEIVED');

    const updated = await db.activateCaseIntake(tenantId, caseId, actingUser.id);
    if (!updated) wrongState(intake, 'RETAINER_RECEIVED'); // lost a race with another activation attempt

    await db.insertCaseIntakeEvent({ caseId, fromState: 'RETAINER_RECEIVED', toState: 'ACTIVATED', actorId: actingUser.id });
    await db.insertAuditLog({
      firmId: tenantId, userId: actingUser.id, action: 'CASE_ACTIVATED', details: { case_id: caseId }
    });

    return toIntakeView(updated);
  }

  /** POST /api/v1/cases/:id/intake/decline — a matter the firm won't take. */
  static async decline(tenantId, actingUser, caseId, reason) {
    const intake = await assertIntake(tenantId, caseId);
    if (intake.state === 'ACTIVATED' || intake.state === 'DECLINED') {
      wrongState(intake, TERMINAL_ORDER.filter(s => s !== 'ACTIVATED'));
    }
    const validatedReason = requireMemo(reason);

    const updated = await transition(tenantId, actingUser, intake, 'DECLINED',
      { declinedAt: new Date(), declinedReason: validatedReason },
      'CASE_INTAKE_DECLINED', { reason: validatedReason });

    await db.updateCaseStatus(tenantId, caseId, 'closed');
    return updated;
  }
}

module.exports = MatterIntakeService;
