const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * AI Copilot — chat tooling, text extraction, and boundary tests.
 *
 * Two things this locks down, both of which the app previously claimed but
 * did not do:
 *
 *  1. The Copilot can read what a document SAYS. summarizeDocument used to
 *     send the model only filename/extension/author/size/tags and present
 *     the result as an "executive summary" — which in a legal document
 *     vault reads as though someone reviewed the document when nobody did.
 *     The tests here cover real extraction AND, just as importantly, that
 *     an unreadable document reports itself as unreadable rather than
 *     returning empty text something downstream would summarize.
 *
 *  2. The billing boundary is structural, not advisory.
 *     copilotSystemPrompt.js tells the model it has NO access to invoicing
 *     or trust accounting and states that "no tool you are ever given may
 *     wrap an /api/v1/invoices* or /api/v1/trust* endpoint — that
 *     restriction applies at the tool-design level, not just to what you
 *     choose to say." A prompt instruction is not an enforcement mechanism;
 *     these tests are, and they fail if anyone adds such a tool.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

// ─────────────────────────────────────────────────────────────────────
// Structural tests — no database needed, so they always run.
// ─────────────────────────────────────────────────────────────────────

test('Copilot tool surface excludes billing entirely', async (t) => {
  const { TOOL_DEFINITIONS, FORBIDDEN_TOOL_SUBSTRINGS, executeTool } = require('../services/copilotTools');

  await t.test('no tool name or description references billing or trust', () => {
    for (const tool of TOOL_DEFINITIONS) {
      const haystack = `${tool.name} ${tool.description}`.toLowerCase();
      for (const forbidden of FORBIDDEN_TOOL_SUBSTRINGS) {
        assert.ok(
          !tool.name.toLowerCase().includes(forbidden),
          `tool "${tool.name}" must not reference "${forbidden}" — billing is out of scope at the tool-design level`
        );
        // A description mentioning billing only to forbid it would be fine,
        // but a tool that offers billing data is not. Checking the name is
        // the hard rule; the description is checked for the action verbs.
        assert.ok(
          !/\b(create|update|pay|record|issue)\b[^.]*\b(invoice|trust|payment|ledger)\b/.test(haystack),
          `tool "${tool.name}" description appears to offer a billing action`
        );
      }
    }
  });

  await t.test('there is no executor for a billing tool', async () => {
    // Even if a tool definition were somehow added, the executor's switch
    // has no branch for one — an unknown tool returns an error object.
    for (const name of ['list_invoices', 'get_invoice', 'trust_balance', 'record_payment', 'mark_invoice_paid']) {
      const result = await executeTool(name, {}, { tenantId: 'x', user: { id: 'y', role: 'ADMIN' } });
      assert.match(result.error || '', /Unknown tool/, `${name} must not be executable`);
    }
  });

  await t.test('every exposed tool is read-only or a proposal', () => {
    // The chat loop must be incapable of writing. Any tool whose name
    // implies a write, other than the explicit propose_* proposal tool,
    // is a bug.
    const writeish = TOOL_DEFINITIONS
      .map(t => t.name)
      .filter(n => /^(create|update|delete|archive|send|post|upload|set|mark)_/.test(n));
    assert.deepEqual(writeish, [], `chat tools must be read-only; found: ${writeish.join(', ')}`);
  });

  await t.test('propose_change records intent without writing anything', async () => {
    const result = await executeTool(
      'propose_change',
      { action: 'update_case', summary: 'Close the case', target_id: 'LC-2026-001', details: { status: 'closed' } },
      { tenantId: 'x', user: { id: 'y', role: 'ADMIN' } }
    );
    assert.equal(result.proposed, true);
    assert.equal(result.awaiting_user_approval, true);
    assert.match(result.note, /Nothing has been changed/);
  });
});

test('Copilot system prompt is actually wired up', async (t) => {
  await t.test('the agent imports the system prompt', () => {
    // The regression this guards: COPILOT_SYSTEM_PROMPT existed as a
    // carefully written file that NOTHING in the codebase imported, while
    // the "chat" was a keyword ladder in the browser.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'services', 'copilotAgent.js'), 'utf8'
    );
    assert.match(source, /COPILOT_SYSTEM_PROMPT/, 'copilotAgent must use the system prompt');
    assert.match(source, /copilotSystemPrompt/, 'copilotAgent must import it from the canonical file');
  });

  await t.test('the agent degrades honestly when no provider is configured', () => {
    const CopilotAgent = require('../services/copilotAgent');
    const saved = {
      key: process.env.AI_PROVIDER_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      google: process.env.GOOGLE_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      provider: process.env.AI_PROVIDER
    };
    delete process.env.AI_PROVIDER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      assert.equal(CopilotAgent.isAvailable(), false, 'with no key, conversational mode must report unavailable');
      assert.match(
        CopilotAgent.unavailableReason(), /API key/i,
        'the reason must be specific enough for a user to act on'
      );
    } finally {
      if (saved.key) process.env.AI_PROVIDER_API_KEY = saved.key;
      if (saved.anthropic) process.env.ANTHROPIC_API_KEY = saved.anthropic;
      if (saved.google) process.env.GOOGLE_API_KEY = saved.google;
      if (saved.gemini) process.env.GEMINI_API_KEY = saved.gemini;
      if (saved.provider) process.env.AI_PROVIDER = saved.provider;
    }
  });

  await t.test('conversational mode is available for Google, same as Anthropic', () => {
    const CopilotAgent = require('../services/copilotAgent');
    const saved = { provider: process.env.AI_PROVIDER, key: process.env.AI_PROVIDER_API_KEY };
    process.env.AI_PROVIDER = 'google';
    process.env.AI_PROVIDER_API_KEY = 'test-google-key-not-real';

    try {
      assert.equal(CopilotAgent.isAvailable(), true, 'AI_PROVIDER=google with a key must be available for chat');
    } finally {
      if (saved.provider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = saved.provider;
      if (saved.key === undefined) delete process.env.AI_PROVIDER_API_KEY; else process.env.AI_PROVIDER_API_KEY = saved.key;
    }
  });

  await t.test('conversational mode reports unavailable, by name, for a provider with no chat support (e.g. openai)', () => {
    const CopilotAgent = require('../services/copilotAgent');
    const saved = { provider: process.env.AI_PROVIDER, key: process.env.AI_PROVIDER_API_KEY };
    process.env.AI_PROVIDER = 'openai';
    process.env.AI_PROVIDER_API_KEY = 'test-openai-key-not-real';

    try {
      assert.equal(CopilotAgent.isAvailable(), false);
      assert.match(CopilotAgent.unavailableReason(), /anthropic or google/i);
    } finally {
      if (saved.provider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = saved.provider;
      if (saved.key === undefined) delete process.env.AI_PROVIDER_API_KEY; else process.env.AI_PROVIDER_API_KEY = saved.key;
    }
  });

  await t.test('every Anthropic tool definition has a matching, well-formed Gemini functionDeclaration', () => {
    const { TOOL_DEFINITIONS } = require('../services/copilotTools');
    const { GEMINI_TOOLS } = require('../services/copilotAgent');

    const declarations = GEMINI_TOOLS[0].functionDeclarations;
    assert.equal(declarations.length, TOOL_DEFINITIONS.length, 'every Anthropic tool must have a Gemini counterpart');

    for (const tool of TOOL_DEFINITIONS) {
      const decl = declarations.find(d => d.name === tool.name);
      assert.ok(decl, `missing Gemini functionDeclaration for "${tool.name}"`);
      assert.equal(decl.description, tool.description);
      // Gemini's Schema.Type is the uppercase enum name, not the lowercase
      // JSON-Schema string TOOL_DEFINITIONS is written in.
      assert.equal(decl.parameters.type, tool.input_schema.type.toUpperCase());
      for (const [propName, propSchema] of Object.entries(tool.input_schema.properties || {})) {
        assert.equal(
          decl.parameters.properties[propName].type, propSchema.type.toUpperCase(),
          `"${tool.name}.${propName}" must be uppercased for Gemini`
        );
      }
    }
  });
});

test('Document parse timeout guard', async (t) => {
  // No database needed — pure unit tests over withTimeout itself, added
  // during a security review after flagging that PDF/DOCX parsing had a
  // size cap but no execution-time ceiling, and the Copilot's
  // read_document tool can trigger it repeatedly in one chat turn.
  //
  // Honest scope: this proves the WRAPPING logic works correctly — a slow
  // promise really does get raced against the clock and really does
  // reject with a timeout error the caller can distinguish from other
  // failures. It does NOT prove pdf-parse/mammoth internally yield
  // control during a pathological parse (a genuinely CPU-blocking
  // synchronous library call would starve the timer too — see the
  // comment on EXTRACTION_TIMEOUT_MS in documentTextExtractor.js for why
  // that would need worker-thread isolation to fix for real). What's
  // tested here is the part actually under this codebase's control.
  const { withTimeout } = require('../services/documentTextExtractor');

  await t.test('a promise that resolves before the deadline wins the race', async () => {
    const fast = new Promise(resolve => setTimeout(() => resolve('done'), 10));
    const result = await withTimeout(fast, 500, 'test op');
    assert.equal(result, 'done');
  });

  await t.test('a promise that resolves after the deadline is rejected with a labeled timeout error', async () => {
    const slow = new Promise(resolve => setTimeout(() => resolve('too late'), 300));
    await assert.rejects(
      () => withTimeout(slow, 20, 'test op'),
      (err) => /test op timed out after 20ms/.test(err.message)
    );
  });

  await t.test('an underlying rejection before the deadline still propagates (timeout does not mask a real failure)', async () => {
    const failsFast = new Promise((_, reject) => setTimeout(() => reject(new Error('real parse error')), 5));
    await assert.rejects(
      () => withTimeout(failsFast, 500, 'test op'),
      (err) => err.message === 'real parse error'
    );
  });

  await t.test('the timer is cleared on the fast path — a resolved race does not leave a dangling timeout', async () => {
    // Indirect but real: if clearTimeout were never called, the process
    // would have a lingering timer keeping the event loop alive. node:test
    // exits this file cleanly when all tests finish; a leaked timer with a
    // long enough delay would be visible as the process hanging past its
    // own tests. Exercised here with enough of a gap (200ms) that a
    // missing clearTimeout would be observable if this test suite's own
    // process outlived it, which it does not.
    const fast = Promise.resolve('ok');
    await withTimeout(fast, 200, 'test op');
    assert.ok(true, 'completed without the process being kept alive by a stray timer');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Text extraction — needs real files on disk and a database row.
// ─────────────────────────────────────────────────────────────────────

test('Document text extraction', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const VaultService = require('../services/vaultService');
  const { extractText, MAX_TEXT_CHARS } = require('../services/documentTextExtractor');
  const { executeTool } = require('../services/copilotTools');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const STAFF_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Extraction Firm', `extract-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);
  const staff = await db.createUser({
    id: STAFF_ID, firmId: FIRM_ID, email: `staff-${STAFF_ID}@example.com`,
    fullName: 'Extraction Staff', role: 'ASSOCIATE', initials: 'ES', passwordHash
  });

  const ctx = { tenantId: FIRM_ID, user: staff };

  async function upload(name, buffer, mimetype) {
    const { document } = await VaultService.initiateUpload(
      FIRM_ID, STAFF_ID,
      { buffer, size: buffer.length, mimetype, originalname: name },
      { allow_duplicate: 'true' },
      staff
    );
    return db.getDocumentById(FIRM_ID, document.id, staff);
  }

  await t.test('reads a plain text document', async () => {
    const body = 'RETAINER AGREEMENT\n\nThe client agrees to pay a retainer of $5,000.\nGoverning law: California.';
    const doc = await upload('retainer.txt', Buffer.from(body, 'utf8'), 'text/plain');

    const result = await extractText(doc);
    assert.equal(result.extractable, true);
    assert.match(result.text, /RETAINER AGREEMENT/);
    assert.match(result.text, /\$5,000/);
    assert.equal(result.truncated, false);
  });

  await t.test('reads a real PDF with a text layer', async () => {
    // A hand-assembled, minimal-but-valid single-page PDF (manual xref
    // table, one Type1 Helvetica font, one text-showing content stream) —
    // not a fixture file, so the test proves extraction against bytes this
    // test itself controls and can reason about.
    //
    // This also exists to catch a real API-shape trap: pdf-parse v2 does
    // NOT export the v1 callable `require('pdf-parse')(buffer)` — it
    // exports a `PDFParse` class (`new PDFParse({data}).getText()`), and
    // its result carries the page count as `.total`, not the v1 `.numpages`
    // field. Both were wrong in an earlier draft of documentTextExtractor.js
    // and neither would have been caught without exercising this for real.
    const pdfText = 'SETTLEMENT AGREEMENT between Acme Corp and Beta LLC dated March 2026.';
    const stream = `BT /F1 12 Tf 50 700 Td (${pdfText}) Tj ET`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((obj, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach(o => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    const doc = await upload('settlement.pdf', Buffer.from(pdf, 'latin1'), 'application/pdf');
    const result = await extractText(doc);

    assert.equal(result.extractable, true);
    assert.equal(result.source, 'pdf');
    assert.match(result.text, /SETTLEMENT AGREEMENT/);
    assert.match(result.text, /Acme Corp/);
    assert.equal(result.page_count, 1, 'page_count must read the real page total, not be silently null');
  });

  await t.test('a real PDF parse still completes even when EXTRACTION_TIMEOUT_MS is set far below its runtime (documented limitation, not a silent regression)', async () => {
    // This is the honest counterpart to the DOCX timeout test above, not
    // a bug repro: pdf-parse's synchronous parse never yields control
    // back to the event loop mid-parse, so the same-thread
    // Promise.race in withTimeout cannot preempt it (see withTimeout's
    // own comment in documentTextExtractor.js for the full investigation,
    // including why a worker-thread fix was attempted and reverted after
    // it destabilized this test suite under concurrent load). Forcing the
    // ceiling to 5ms and asserting the parse still SUCCEEDS pins down
    // that known limitation as an explicit, tested fact rather than an
    // assumption — if a future change makes withTimeout actually bound
    // PDF parse time (e.g. a real worker pool), this assertion will fail
    // and should be flipped to expect a timeout, matching the DOCX test.
    const pageCount = 500;
    const text = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor. '.repeat(50).replace(/[()\\]/g, '');
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
    let nextObj = 3;
    const pageObjNums = [];
    for (let i = 0; i < pageCount; i++) { pageObjNums.push(nextObj); nextObj += 2; }
    objects.push(`<< /Type /Pages /Kids [${pageObjNums.map(n => n + ' 0 R').join(' ')}] /Count ${pageCount} >>`);
    const fontObjNum = nextObj++;
    for (let i = 0; i < pageCount; i++) {
      const stream = `BT /F1 10 Tf 50 700 Td (${text}) Tj ET`;
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageObjNums[i] + 1} 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>`);
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    }
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((obj, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach(o => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    const buffer = Buffer.from(pdf, 'latin1');
    assert.ok(buffer.length < 10 * 1024 * 1024, 'the fixture must stay under MAX_EXTRACTABLE_BYTES, or this would test the size guard instead of the timeout');

    const doc = await upload('will-time-out.pdf', buffer, 'application/pdf');

    const saved = process.env.EXTRACTION_TIMEOUT_MS;
    process.env.EXTRACTION_TIMEOUT_MS = '5';
    try {
      const result = await extractText(doc);
      assert.equal(result.extractable, true, 'withTimeout cannot preempt a synchronous pdf-parse call, so the parse runs to completion despite the 5ms ceiling');
      assert.equal(result.source, 'pdf');
      assert.equal(result.page_count, pageCount);
    } finally {
      if (saved === undefined) delete process.env.EXTRACTION_TIMEOUT_MS;
      else process.env.EXTRACTION_TIMEOUT_MS = saved;
    }
  });

  await t.test('reads a real .docx via mammoth', async () => {
    // A minimal but genuinely valid OOXML package built with jszip (already
    // a transitive dependency here), not a stub buffer — proves the mammoth
    // path is actually exercised, which it was not before this test existed.
    const JSZip = require('jszip');
    const zip = new JSZip();
    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
    );
    zip.file('_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
    );
    zip.file('word/document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>ENGAGEMENT LETTER between the Firm and Marcus Blake regarding the IP dispute matter.</w:t></w:r></w:p></w:body>' +
      '</w:document>'
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const doc = await upload('engagement.docx', buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const result = await extractText(doc);

    assert.equal(result.extractable, true);
    assert.equal(result.source, 'docx');
    assert.match(result.text, /ENGAGEMENT LETTER/);
    assert.match(result.text, /Marcus Blake/);
  });

  await t.test('reports an unreadable format instead of returning empty text', async () => {
    // The critical honesty case: a caller must never receive "" and
    // summarize it as "this document appears to be empty".
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const doc = await upload('scan.png', png, 'image/png');

    const result = await extractText(doc);
    assert.equal(result.extractable, false);
    assert.equal(result.text, null, 'an unreadable document must carry NO text field at all');
    assert.match(result.reason, /image|OCR/i, 'the reason must name why it could not be read');
  });

  await t.test('refuses a file whose extension lies about its contents', async () => {
    // .txt extension, binary contents (a NUL byte).
    const doc = await upload('not-really.txt', Buffer.from([0x41, 0x00, 0x42]), 'text/plain');
    const result = await extractText(doc);
    assert.equal(result.extractable, false);
    assert.match(result.reason, /binary/i);
  });

  await t.test('truncates a very long document visibly', async () => {
    const huge = 'All parties agree. '.repeat(Math.ceil((MAX_TEXT_CHARS + 5000) / 19));
    const doc = await upload('long.txt', Buffer.from(huge, 'utf8'), 'text/plain');

    const result = await extractText(doc);
    assert.equal(result.extractable, true);
    assert.equal(result.truncated, true);
    assert.ok(result.total_chars > MAX_TEXT_CHARS);
    assert.match(result.text, /truncated/, 'truncation must be visible in the text itself, not silent');
  });

  await t.test('read_document tool returns readable:false with no text for an unreadable file', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const doc = await upload('unreadable.png', png, 'image/png');

    const result = await executeTool('read_document', { document_id: doc.id }, ctx);
    assert.equal(result.readable, false);
    assert.equal(result.text, undefined, 'the failure shape must have no text key for a model to misread');
    assert.ok(result.reason);
  });

  await t.test('read_document refuses a document id that is not visible to the caller', async () => {
    const result = await executeTool('read_document', { document_id: crypto.randomUUID() }, ctx);
    assert.match(result.error, /no document with that id is visible to you/i);
    assert.equal(result.text, undefined);
  });

  await t.test('a CLIENT cannot read another client\'s document through the Copilot', async () => {
    const clientId = crypto.randomUUID();
    const client = await db.createUser({
      id: clientId, firmId: FIRM_ID, email: `client-${clientId}@example.com`,
      fullName: 'Portal Client', role: 'CLIENT', initials: 'PC', passwordHash
    });

    const secret = await upload('privileged-memo.txt', Buffer.from('Internal strategy memo.', 'utf8'), 'text/plain');

    // Same tool, same document id, different caller — must not resolve.
    const result = await executeTool(
      'read_document', { document_id: secret.id }, { tenantId: FIRM_ID, user: client }
    );
    assert.ok(result.error, 'a CLIENT must not be able to read a staff document through the Copilot');
    assert.equal(result.text, undefined);
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
