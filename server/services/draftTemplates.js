/**
 * Draft Template Library (Phase 4)
 *
 * The RFP's named top 5 drafting templates. Each entry names the sections
 * the AI provider is asked to fill and a short guidance line steering what
 * that section should contain — this is prompt content, not a document
 * layout engine; server/services/draftService.js turns a template's
 * sections into a JSON schema instruction for the model, the same way
 * matterAnalysisService.js's system prompts describe the shape it wants
 * back rather than rendering anything itself.
 *
 * Static and bundled with the app (not a DB table — see 0025_drafts.sql's
 * comment #2) because these five are fixed content the firm doesn't edit
 * at runtime; only the generated drafts themselves are persisted.
 */

const TEMPLATES = {
  interlocutory_application: {
    label: 'Interlocutory Application',
    sections: [
      { heading: 'Title & Cause', guidance: 'Case caption and the specific interim relief being applied for.' },
      { heading: 'Grounds', guidance: 'The facts and reasoning supporting the interim relief, drawn from the chronology and issue matrix.' },
      { heading: 'Prayer', guidance: 'The precise relief sought from the court.' }
    ]
  },
  adjournment: {
    label: 'Adjournment Application',
    sections: [
      { heading: 'Reason for Adjournment', guidance: 'Why the matter cannot proceed on the scheduled date.' },
      { heading: 'Prejudice Statement', guidance: 'Confirmation that no party is prejudiced by the adjournment, or how any prejudice is addressed.' },
      { heading: 'Prayer', guidance: 'The specific adjournment/new date being requested.' }
    ]
  },
  exemption: {
    label: 'Exemption Application',
    sections: [
      { heading: 'Requirement Sought to be Exempted', guidance: 'The procedural requirement (e.g. personal appearance, filing format) the exemption applies to.' },
      { heading: 'Grounds for Exemption', guidance: 'Why compliance is impracticable or unnecessary here.' },
      { heading: 'Prayer', guidance: 'The precise exemption being requested.' }
    ]
  },
  delay_condonation: {
    label: 'Delay Condonation Application',
    sections: [
      { heading: 'Period of Delay', guidance: 'The exact delay being condoned, computed from the chronology\'s dates.' },
      { heading: 'Reasons for Delay', guidance: 'The sufficient cause explaining the delay.' },
      { heading: 'Prayer', guidance: 'The specific condonation being requested.' }
    ]
  },
  stay: {
    label: 'Stay Application',
    sections: [
      { heading: 'Order/Proceeding Sought to be Stayed', guidance: 'The specific order or proceeding, identified from the chronology.' },
      { heading: 'Grounds for Stay', guidance: 'Balance of convenience, irreparable harm, and prima facie case, drawn from the issue matrix.' },
      { heading: 'Prayer', guidance: 'The precise stay being requested, including duration if applicable.' }
    ]
  }
};

const VALID_TEMPLATE_KEYS = Object.keys(TEMPLATES);

// Loose free-text match against a hearing's `suggested_draft` field (e.g.
// "Adjournment Application" — see 0022's comment on that column) so
// generation can be triggered from the task it produced without staff
// re-typing which of the five templates it means. Returns null, not a
// guess, when nothing matches — draftService then requires an explicit
// template_key rather than silently picking the wrong one.
function matchTemplateKey(freeText) {
  if (!freeText) return null;
  const normalized = String(freeText).toLowerCase();
  for (const key of VALID_TEMPLATE_KEYS) {
    const label = TEMPLATES[key].label.toLowerCase();
    if (normalized.includes(key.replace(/_/g, ' ')) || normalized.includes(label)) {
      return key;
    }
  }
  return null;
}

function getTemplate(templateKey) {
  return TEMPLATES[templateKey] || null;
}

module.exports = { TEMPLATES, VALID_TEMPLATE_KEYS, matchTemplateKey, getTemplate };
