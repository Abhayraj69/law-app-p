const fs = require('fs/promises');
const path = require('path');
const { resolveStoragePath } = require('./fileService');
const baseLogger = require('../utils/logger');

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

// Formats we can identify but genuinely cannot read as text. Listed
// explicitly so the reason given to the user names the format instead of a
// generic "unsupported" — and so adding a parser later is a one-line change.
const KNOWN_UNREADABLE = {
  doc: 'Legacy Word (.doc) files need conversion to .docx before their text can be read.',
  xls: 'Legacy Excel (.xls) files are not text-extractable here.',
  xlsx: 'Spreadsheets are not text-extractable here — open the file to review its contents.',
  ppt: 'Legacy PowerPoint (.ppt) files are not text-extractable here.',
  pptx: 'Presentations are not text-extractable here — open the file to review its slides.',
  png: 'Images have no text layer to read. Scanned documents would need OCR, which is not configured.',
  jpg: 'Images have no text layer to read. Scanned documents would need OCR, which is not configured.',
  jpeg: 'Images have no text layer to read. Scanned documents would need OCR, which is not configured.',
  gif: 'Images have no text layer to read.',
  zip: 'Archives are not text-extractable — extract the archive and upload the documents individually.'
};

// Extraction reads the whole file into memory and parses it synchronously
// enough to matter, so cap it well below the 50MB upload limit. Same
// reasoning as fileService's MAX_DIFFABLE_BYTES.
const MAX_EXTRACTABLE_BYTES = 10 * 1024 * 1024; // 10MB

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

  if (!isPlain && !isPdf && !isDocx) {
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
      // Required lazily: pdf-parse pulls in a sizeable dependency tree, and
      // most requests in this app never touch a PDF.
      //
      // NOTE the API shape: pdf-parse v2 exports a PDFParse CLASS. The v1
      // `require('pdf-parse')(buffer)` callable that most examples online
      // still show is not a function here and throws immediately.
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      let parsed;
      try {
        parsed = await parser.getText();
      } finally {
        // Frees the underlying pdf.js document; skipping this leaks worker
        // resources across repeated extractions.
        if (typeof parser.destroy === 'function') await parser.destroy();
      }
      const normalized = normalizeWhitespace(parsed.text);
      if (!normalized) {
        // A PDF with no text layer is almost always a scan. Saying that is
        // far more useful than returning "" and letting a caller summarize
        // an empty string.
        return unreadable(
          'This PDF contains no extractable text layer — it is most likely a scan. ' +
          'Reading it would need OCR, which is not configured.'
        );
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

    if (isDocx) {
      const mammoth = require('mammoth');
      const parsed = await mammoth.extractRawText({ buffer });
      const normalized = normalizeWhitespace(parsed.value);
      if (!normalized) {
        return unreadable('This Word document contains no readable text.');
      }
      const { text, truncated, total_chars } = truncate(normalized);
      return { extractable: true, reason: null, text, truncated, total_chars, source: 'docx' };
    }
  } catch (err) {
    // A corrupt or password-protected file is a normal thing to encounter,
    // not a server fault — report it as unreadable rather than a 500.
    log.error('failed to extract document text', {
      context: 'EXTRACT', document_id: doc.id, file_name: doc.file_name, error: err.message
    });
    return unreadable(`This file could not be parsed — it may be corrupt or password-protected.`);
  }

  return unreadable('No text extractor matched this document.');
}

module.exports = {
  extractText,
  // Exported for tests and for callers that want to tell a user up front
  // whether a document is readable without doing the work.
  PLAIN_TEXT_EXTENSIONS,
  KNOWN_UNREADABLE,
  MAX_EXTRACTABLE_BYTES,
  MAX_TEXT_CHARS
};
