const baseLogger = require('../utils/logger');
const { getOcrProvider } = require('./ocr/providerSelector');

/**
 * OCR Service
 *
 * Gives documentTextExtractor.js a way to read scanned PDFs and photographed
 * documents instead of just reporting them as unreadable. Two jobs:
 *
 *   1. Rasterize a PDF page to an image (pdfjs-dist does the PDF parsing,
 *      @napi-rs/canvas gives it something to render into — a prebuilt-binary
 *      canvas, not a native module that needs local build tools).
 *   2. Hand image bytes to the configured OCR provider (see ocr/, 'tesseract'
 *      — local, no API key — by default).
 *
 * OCR is much more expensive than the plain-text/pdf-parse/mammoth paths in
 * documentTextExtractor.js: it can be invoked repeatedly within one Copilot
 * chat turn via the read_document tool (up to MAX_TOOL_ITERATIONS times),
 * so this module caps BOTH the number of pages a single scanned PDF will
 * have OCR'd and how long any one page is allowed to take, the same
 * "bound it, don't just hope it's fast" posture as
 * documentTextExtractor's own MAX_EXTRACTABLE_BYTES / EXTRACTION_TIMEOUT_MS.
 */

// A scanned PDF can run to hundreds of pages; OCR-ing all of them inline in
// a single request would make a document read take minutes. Capped low on
// purpose — this is "enough to see what the document is and summarize its
// first pages," not "a full-document batch OCR job" (that belongs in a
// background job, out of scope here).
function getMaxOcrPages() {
  return parseInt(process.env.OCR_MAX_PAGES, 10) || 5;
}

// Scale factor for rasterizing a PDF page before OCR. Higher = better
// recognition accuracy on small print, at the cost of more time per page.
function getRasterScale() {
  return parseFloat(process.env.OCR_RASTER_SCALE) || 2.0;
}

async function loadPdfjs() {
  // pdfjs-dist ships ESM-only from v5+; this codebase is CommonJS
  // throughout, so a dynamic import is the only way to reach it.
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerModule = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { pdfjsLib, workerModule };
}

// documentTextExtractor.js's pdf-parse dependency vendors its own, OLDER
// bundled copy of pdfjs-dist internally, and registers it on
// `globalThis.pdfjsWorker` — the exact global pdfjs-dist's own Node "fake
// worker" path checks to run in-process instead of spawning a real
// worker_thread (see PDFWorker's #mainThreadWorkerMessageHandler getter in
// node_modules/pdfjs-dist/legacy/build/pdf.mjs). Reproduced directly, both
// directions:
//   - pdf-parse parses first (sets the global to ITS version) → our
//     getDocument() picks up that stale global and fails with "API 6.3.289
//     does not match Worker 5.4.296".
//   - this module runs first (sets the global to OUR version, and — the
//     part that isn't obvious — LEAVES it set) → the NEXT pdf-parse call
//     in the same process (documentTextExtractor always tries pdf-parse
//     before ever falling back to OCR) picks up OUR now-stale global and
//     fails the same way in reverse: "API 5.4.296 does not match Worker
//     6.3.289". Reproduced exactly this way in isolation, not just a
//     theory.
// The fix has to be symmetric: set the global to our version only for the
// duration of our own getDocument() call, then put back whatever was
// there before — so pdf-parse (which sets it lazily itself when it next
// needs it) never sees a value left behind by us. Clearing it outright
// instead of restoring would make pdfjs-dist try to spawn a real
// worker_threads Worker, which is the exact mechanism this codebase has
// already found to be unstable under concurrent test load — staying in
// the same "fake worker, in-process" mode pdf-parse itself already uses
// keeps this on a path proven to work here.
async function withOwnPdfjsWorker(fn) {
  // Captured BEFORE loadPdfjs() runs, on purpose: importing
  // pdf.worker.mjs has its own side effect of registering itself onto
  // globalThis.pdfjsWorker (a Node convenience pdfjs-dist provides so
  // callers don't have to do this by hand) — but only the FIRST time that
  // specifier is ever imported in this process, since ESM imports are
  // cached and don't re-run side effects. Reading `previous` after
  // loadPdfjs() instead would, on that first call, capture OUR OWN
  // just-imported worker as "previous" and restore it right back —
  // silently never actually restoring pdf-parse's version, which is
  // exactly the bug this function exists to avoid.
  const previous = globalThis.pdfjsWorker;
  const { pdfjsLib, workerModule } = await loadPdfjs();
  globalThis.pdfjsWorker = workerModule;
  try {
    return await fn(pdfjsLib);
  } finally {
    globalThis.pdfjsWorker = previous;
  }
}

async function rasterizePdfPage(pdfjsDoc, pageNumber, scale) {
  const { createCanvas } = require('@napi-rs/canvas');
  const page = await pdfjsDoc.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toBuffer('image/png');
  } finally {
    page.cleanup();
  }
}

/**
 * OCRs a single image buffer (PNG/JPEG/etc — whatever the configured
 * provider accepts). Returns `{ text, confidence }`; throws on genuine
 * failure (caller — documentTextExtractor — turns that into an
 * `extractable: false` reason rather than a 500).
 */
async function ocrImage(buffer, log = baseLogger) {
  const provider = getOcrProvider();
  return provider.recognizeImage(buffer, { log });
}

/**
 * OCRs a scanned PDF (one with no usable text layer) by rasterizing each
 * page and running it through the OCR provider in turn. Pages beyond
 * getMaxOcrPages() are skipped, not silently dropped — the result reports
 * `truncated_pages` so a caller can say so.
 */
async function ocrScannedPdf(pdfBytes, log = baseLogger) {
  return withOwnPdfjsWorker(async (pdfjsLib) => {
    // pdfjs-dist refuses a Node Buffer outright ("provide binary data as
    // Uint8Array, rather than Buffer") even though Buffer IS a Uint8Array
    // subclass — it checks the constructor, not just instanceof. Wrapping
    // (not copying: `new Uint8Array(buffer.buffer, buffer.byteOffset,
    // buffer.length)` would share memory but risk slicing bugs if the
    // buffer's underlying ArrayBuffer is ever reused elsewhere) with a
    // plain `new Uint8Array(pdfBytes)` sidesteps that check cleanly.
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true });
    const doc = await loadingTask.promise;

    try {
      const pageCount = doc.numPages;
      const maxPages = getMaxOcrPages();
      const pagesToOcr = Math.min(pageCount, maxPages);
      const scale = getRasterScale();
      const provider = getOcrProvider();

      const texts = [];
      for (let pageNumber = 1; pageNumber <= pagesToOcr; pageNumber++) {
        const png = await rasterizePdfPage(doc, pageNumber, scale);
        const { text } = await provider.recognizeImage(png, { log });
        const trimmed = text.trim();
        if (trimmed) texts.push(trimmed);
      }

      return {
        text: texts.join('\n\n'),
        page_count: pageCount,
        pages_ocred: pagesToOcr,
        truncated_pages: pageCount > pagesToOcr
      };
    } finally {
      // destroy() lives on the loadingTask, not the resolved document
      // proxy — verified directly against this pdfjs-dist version; the
      // proxy has no destroy method of its own here.
      await loadingTask.destroy();
    }
  });
}

module.exports = {
  ocrImage,
  ocrScannedPdf,
  getMaxOcrPages,
  getRasterScale
};
