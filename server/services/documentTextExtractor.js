const fs = require('fs/promises');
const { resolveStoragePath } = require('./fileService');
const baseLogger = require('../utils/logger');
const ocrService = require('./ocrService');

/**
 * Document Text Extractor
 *
 * Pulls the actual text content out of a stored document so the AI Copilot
 * can reason about what a document SAYS, not just what its metadata claims.
 *
 * This exists because summarizeDocument used to send the model only the
 * filename, extension, author, size and tags — so its "executive summary"
 * was a sentence about a file's metadata dressed up as a summary of its
 * contents. For a legal document vault that is worse than no summary: it
 * reads as though someone reviewed the document when nobody did.
 *
 * Design rules, in order of importance:
 *
 *   1. Never invent. If a format can't be read, say so explicitly
 *      (`extractable: false` plus a human-readable reason) rather than
 *      returning empty text that a caller might summarize as "this
 *      document appears to be empty."
 *   2. Never hang the event loop. Extraction is capped by file size, and
 *      the returned text is capped in characters before it ever reaches a
 *      model's context window.
 *   3. Never read outside the storage root. Paths go through
 *      fileService.resolveStoragePath, which already refuses to escape it.
 */

// Formats whose bytes are text as-is. Deliberately the same set
// fileService treats as line-diffable, plus a couple that make sense to
// read but not to diff — keeping one mental model of "text-like" in the app.
const PLAIN_TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'html', 'htm',
  'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'sql',
  'yaml', 'yml', 'sh', 'rtf'
]);

// Formats that need a real parser to get text out.
const PDF_EXTENSIONS = new Set(['pdf']);
const DOCX_EXTENSIONS = new Set(['docx']);

// Image formats with no text layer of their own — read via OCR (see
// ocrService.js) rather than refused outright. gif is deliberately left out:
// it's rarely a scanned document and tesseract.js's image decoders don't
// cover it, so it stays in KNOWN_UNREADABLE below.
const OCR_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);

// Formats we can identify but genuinely cannot read as text. Listed
// explicitly so the reason given to the user names the format instead of a
// generic "unsupported" — and so adding a parser later is a one-line change.
const KNOWN_UNREADABLE = {
  doc: 'Legacy Word (.doc) files need conversion to .docx before their text can be read.',
  xls: 'Legacy Excel (.xls) files are not text-extractable here.',
  xlsx: 'Spreadsheets are not text-extractable here — open the file to review its contents.',
  ppt: 'Legacy PowerPoint (.ppt) files are not text-extractable here.',
  pptx: 'Presentations are not text-extractable here — open the file to review its slides.',
  gif: 'Images have no text layer to read, and this format is not OCR-supported here.',
  zip: 'Archives are not text-extractable — extract the archive and upload the documents individually.'
};

// Extraction reads the whole file into memory and parses it synchronously
// enough to matter, so cap it well below the 50MB upload limit. Same
// reasoning as fileService's MAX_DIFFABLE_BYTES.
const MAX_EXTRACTABLE_BYTES = 10 * 1024 * 1024; // 10MB

// A ceiling on how long a single PDF/DOCX parse is allowed to run, found
// worth adding during a security review: the size cap above bounds INPUT
// size, but not parse TIME — a small, adversarially structured PDF can
// still make some parsers spend a very long time on it, and the Copilot's
// read_document tool can now trigger this parsing repeatedly (once per
// tool call, up to MAX_TOOL_ITERATIONS times) within a single chat turn
// with nothing else bounding it.
//
// A function, not a frozen module-level const, matching how
// aiProvider.js's equivalent (AI_REQUEST_TIMEOUT_MS, read inside
// getRequestConfig()) is resolved fresh on every call rather than once at
// require time — the same reason server/utils/logger.js reads NODE_ENV
// lazily. Baking this into a top-level const would mean whatever
// EXTRACTION_TIMEOUT_MS happened to be set to the moment this module was
// first required is what every extraction gets for the lifetime of the
// process, with no way to override it per-call (a test wanting to force a
// fast timeout, for instance) or to see a later env change take effect.
function getExtractionTimeoutMs() {
  return parseInt(process.env.EXTRACTION_TIMEOUT_MS, 10) || 15000;
}

// Races a parse against a timer. Proven, not assumed, to actually work
// for mammoth (DOCX): raced a genuinely large real .docx (20,000
// paragraphs) against a 5ms timer and the timer fired right on schedule
// — mammoth's parse yields control back to the event loop during a long
// parse, so a same-thread race can genuinely preempt it.
//
// pdf-parse is a different story, and this is worth being honest about
// rather than assuming the fix generalizes: the same style of test — race
// a large real PDF (2000 pages, a ~1 second parse) against a 5ms timer —
// showed the timer never fires, not once across repeated runs. pdf-parse's
// Node.js parse runs as one long blocking stretch with nothing yielding
// control, so withTimeout below does not actually bound PDF parse time in
// the way it looks like it does; it will "expire" and reject once the
// blocking parse finally finishes and control returns to the event loop,
// which is too late to have prevented anything.
//
// A worker thread — spawning pdf-parse on a separate OS thread that
// worker.terminate() can kill from the outside regardless of whether the
// code inside ever yields — is the mechanism that actually fixes this,
// and an earlier version of this file did exactly that. It was reverted:
// under this project's own concurrent test suite (many test files each
// opening their own Postgres pool, running together), spawning a worker
// thread crashed the whole test process outright — reproduced 4/4 times,
// and confirmed with a diagnostic worker that didn't even touch pdf-parse
// (just posted a message back immediately), which crashed just as
// consistently. That points at worker-thread creation itself being
// unstable under this environment's concurrent load, not a bug in the
// worker code — but "probably fine in a normal deployment" isn't
// something provable from here, and shipping a fix that can bring down
// the process it's supposed to be protecting is a worse outcome than the
// gap it was meant to close. Real worker-based protection needs a small
// persistent worker POOL (workers created once, reused, and only
// respawned on an actual timeout) rather than a worker spawned per parse
// — a larger, separately-scoped piece of work, not attempted here.
//
// What PDF parsing keeps in the meantime: the MAX_EXTRACTABLE_BYTES size
// cap (the primary defense — bounds how much there is to parse at all),
// and this same withTimeout wrapper as a best-effort measure that is
// honestly documented as non-blocking for PDF specifically, not silently
// left implying protection it cannot provide.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// How much text is handed back to a caller. A model's context window is
// finite and a legal document can be enormous; truncating here — visibly,
// with a marker — is better than either blowing the context window or
// silently sending a fraction of the document as though it were all of it.
const MAX_TEXT_CHARS = 60000;

function extensionOf(fileName) {
  const match = /\.([^.]+)$/.exec(fileName || '');
  return match ? match[1].toLowerCase() : '';
}

// Collapses runs of blank lines and trailing whitespace. PDF and DOCX
// extraction both produce a lot of incidental whitespace that would
// otherwise eat context window for nothing.
function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// pdf-parse v2's getText() inserts a `-- N of M --` separator between every
// page's text, unconditionally — even a totally blank/scanned page with no
// real content still produces one. Found while testing the OCR fallback
// below: a genuinely blank single page normalizes to `-- 1 of 1 --`, not
// "", so the "no text layer, most likely a scan" check would never have
// fired for a real single-page scan — normalizeWhitespace alone can't tell
// pdf-parse's own formatting from actual document text. Stripped before
// that check (and before truncate/return) so it never counts as content
// and never eats characters out of MAX_TEXT_CHARS either.
function stripPdfParsePageMarkers(text) {
  return String(text || '').replace(/^-- \d+ of \d+ --$/gm, '');
}

function truncate(text) {
  if (text.length <= MAX_TEXT_CHARS) {
    return { text, truncated: false, total_chars: text.length };
  }
  return {
    // The marker is part of the returned text on purpose: whatever consumes
    // this (including a model) should be able to see that it is reading a
    // prefix, not the whole document.
    text: text.slice(0, MAX_TEXT_CHARS) + '\n\n[... truncated: this document continues beyond the extraction limit ...]',
    truncated: true,
    total_chars: text.length
  };
}

function unreadable(reason) {
  return { extractable: false, reason, text: null, truncated: false, total_chars: 0 };
}

/**
 * Extracts text from a stored document row (as returned by
 * db.getDocumentById — needs `file_name` and `storage_path_url`).
 *
 * Always resolves; never throws for an unreadable document. A caller that
 * gets `extractable: false` should surface `reason` rather than proceeding
 * as though the document were empty.
 *
 * `log` is optional and defaults to the request-less base logger — pass
 * the calling request's `req.log` (server/middleware/requestContext.js)
 * when one is available, so a parse failure is correlated to the request
 * and user that triggered it instead of appearing as an anonymous line.
 */
async function extractText(doc, log = baseLogger) {
  if (!doc) return unreadable('Document not found.');

  const ext = extensionOf(doc.file_name);

  if (!doc.storage_path_url) {
    // Seed/demo documents exist as metadata with no bytes on disk — the
    // same case fileService's download path reports as NO_FILE_CONTENT.
    return unreadable('This document has no stored file content (metadata-only record).');
  }

  if (KNOWN_UNREADABLE[ext]) {
    return unreadable(KNOWN_UNREADABLE[ext]);
  }

  const isPlain = PLAIN_TEXT_EXTENSIONS.has(ext);
  const isPdf = PDF_EXTENSIONS.has(ext);
  const isDocx = DOCX_EXTENSIONS.has(ext);
  const isOcrImage = OCR_IMAGE_EXTENSIONS.has(ext);

  if (!isPlain && !isPdf && !isDocx && !isOcrImage) {
    return unreadable(`No text extractor is available for .${ext || 'unknown'} files.`);
  }

  let absolutePath;
  try {
    absolutePath = resolveStoragePath(doc.storage_path_url);
  } catch {
    return unreadable('This document\'s stored path could not be resolved.');
  }

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return unreadable('The stored file for this document is missing from disk.');
  }

  if (stat.size > MAX_EXTRACTABLE_BYTES) {
    return unreadable(
      `This document is ${(stat.size / (1024 * 1024)).toFixed(1)}MB, over the ` +
      `${MAX_EXTRACTABLE_BYTES / (1024 * 1024)}MB text-extraction limit.`
    );
  }

  if (stat.size === 0) {
    return unreadable('This document is empty (0 bytes).');
  }

  let buffer;
  try {
    buffer = await fs.readFile(absolutePath);
  } catch (err) {
    return unreadable('The stored file for this document could not be read.');
  }

  try {
    if (isPlain) {
      // A NUL byte means this isn't really text whatever the extension
      // claims — same sniff fileService.looksLikeText uses.
      if (buffer.includes(0)) {
        return unreadable(`This file is named .${ext} but its contents are binary, not text.`);
      }
      const { text, truncated, total_chars } = truncate(normalizeWhitespace(buffer.toString('utf8')));
      return { extractable: true, reason: null, text, truncated, total_chars, source: 'plaintext' };
    }

    if (isPdf) {
      // pdf-parse v2 exports a PDFParse CLASS. The v1
      // `require('pdf-parse')(buffer)` callable that most examples online
      // still show is not a function there and throws immediately.
      //
      // withTimeout here is a best-effort measure only — see its own
      // comment above for the proof that it does NOT actually bound PDF
      // parse time the way it does for DOCX. A timeout and a genuine parse
      // failure (corrupt PDF, etc.) both reach the outer catch block below,
      // which already distinguishes them by message and gives the timeout
      // case its own, more specific, user-facing reason.
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      let parsed;
      try {
        parsed = await withTimeout(parser.getText(), getExtractionTimeoutMs(), 'PDF parse');
      } finally {
        if (typeof parser.destroy === 'function') await parser.destroy();
      }
      const normalized = normalizeWhitespace(stripPdfParsePageMarkers(parsed.text));
      if (!normalized) {
        // A PDF with no text layer is almost always a scan — fall back to
        // OCR rather than refusing outright. Errors from OCR itself (a
        // corrupt PDF pdfjs can't even open, a provider failure) are
        // reported as a reason, same as every other unreadable case, not
        // thrown — this path already tried its best with pdf-parse.
        try {
          const ocrResult = await ocrService.ocrScannedPdf(buffer, log);
          if (!ocrResult.text) {
            return unreadable(
              'This PDF contains no extractable text layer, and OCR found no readable text on its ' +
              `first ${ocrResult.pages_ocred} page(s) either — it may be a blank or very low-quality scan.`
            );
          }
          const { text, truncated, total_chars } = truncate(normalizeWhitespace(ocrResult.text));
          return {
            extractable: true, reason: null, text, truncated, total_chars,
            source: 'pdf-ocr', page_count: ocrResult.page_count,
            pages_ocred: ocrResult.pages_ocred, ocr_truncated_pages: ocrResult.truncated_pages
          };
        } catch (ocrErr) {
          log.error('OCR fallback failed for scanned PDF', {
            context: 'EXTRACT', document_id: doc.id, file_name: doc.file_name, error: ocrErr.message
          });
          return unreadable(
            'This PDF contains no extractable text layer — it is most likely a scan, and OCR was ' +
            `unable to read it (${ocrErr.message}).`
          );
        }
      }
      const { text, truncated, total_chars } = truncate(normalized);
      return {
        extractable: true, reason: null, text, truncated, total_chars,
        // pdf-parse v2's getText() result exposes the page count as
        // `total`, not `numpages` (that was the v1 field name) — verified
        // against a real PDF; `numpages` is undefined here and would have
        // silently left page_count always null.
        source: 'pdf', page_count: parsed.total || null
      };
    }

    if (isOcrImage) {
      try {
        const { text, confidence } = await ocrService.ocrImage(buffer, log);
        const normalized = normalizeWhitespace(text);
        if (!normalized) {
          return unreadable('OCR found no readable text in this image.');
        }
        const { text: truncatedText, truncated, total_chars } = truncate(normalized);
        return {
          extractable: true, reason: null, text: truncatedText, truncated, total_chars,
          source: 'image-ocr', ocr_confidence: confidence
        };
      } catch (ocrErr) {
        log.error('OCR failed for image document', {
          context: 'EXTRACT', document_id: doc.id, file_name: doc.file_name, error: ocrErr.message
        });
        return unreadable(`This image could not be read by OCR (${ocrErr.message}).`);
      }
    }

    if (isDocx) {
      const mammoth = require('mammoth');
      const parsed = await withTimeout(mammoth.extractRawText({ buffer }), getExtractionTimeoutMs(), 'DOCX parse');
      const normalized = normalizeWhitespace(parsed.value);
      if (!normalized) {
        return unreadable('This Word document contains no readable text.');
      }
      const { text, truncated, total_chars } = truncate(normalized);
      return { extractable: true, reason: null, text, truncated, total_chars, source: 'docx' };
    }
  } catch (err) {
    // A corrupt or password-protected file is a normal thing to encounter,
    // not a server fault — report it as unreadable rather than a 500. A
    // timeout (see withTimeout/EXTRACTION_TIMEOUT_MS above) gets its own,
    // more specific message rather than being lumped in as "corrupt".
    log.error('failed to extract document text', {
      context: 'EXTRACT', document_id: doc.id, file_name: doc.file_name, error: err.message
    });
    if (/timed out after/.test(err.message)) {
      return unreadable('This document took too long to parse and was skipped rather than left running indefinitely.');
    }
    return unreadable(`This file could not be parsed — it may be corrupt or password-protected.`);
  }

  return unreadable('No text extractor matched this document.');
}

module.exports = {
  extractText,
  // Exported for tests and for callers that want to tell a user up front
  // whether a document is readable without doing the work.
  PLAIN_TEXT_EXTENSIONS,
  OCR_IMAGE_EXTENSIONS,
  KNOWN_UNREADABLE,
  MAX_EXTRACTABLE_BYTES,
  MAX_TEXT_CHARS,
  getExtractionTimeoutMs,
  withTimeout
};
