const { PDFDocument } = require('pdf-lib');

/**
 * PDF merge/split tooling — the other half of Phase 0 alongside ocrService,
 * used to bundle several uploaded documents into one PDF (e.g. a
 * consultation's document bundle) and to pull individual pages back out.
 * Pure pdf-lib, no rasterization/OCR involved, so unlike ocrService there is
 * no worker-thread cost or concurrency caution here.
 */

// Same reasoning as documentTextExtractor's MAX_EXTRACTABLE_BYTES: bound
// how much a single merge/split call will hold in memory at once.
const MAX_INPUT_PDFS = 50;

async function loadPdf(bytes) {
  try {
    return await PDFDocument.load(bytes);
  } catch (err) {
    throw new Error(`Could not read this file as a PDF: ${err.message}`);
  }
}

/**
 * Returns the page count of a PDF buffer.
 */
async function getPageCount(bytes) {
  const doc = await loadPdf(bytes);
  return doc.getPageCount();
}

/**
 * Merges multiple PDF buffers into one, in the given order. Returns the
 * merged PDF as a Buffer.
 */
async function mergePdfs(buffers) {
  if (!Array.isArray(buffers) || buffers.length === 0) {
    throw new Error('mergePdfs needs at least one PDF.');
  }
  if (buffers.length > MAX_INPUT_PDFS) {
    throw new Error(`Too many PDFs to merge in one call (${buffers.length} > ${MAX_INPUT_PDFS}).`);
  }

  const merged = await PDFDocument.create();
  for (const bytes of buffers) {
    const source = await loadPdf(bytes);
    const pageIndices = source.getPageIndices();
    const copiedPages = await merged.copyPages(source, pageIndices);
    for (const page of copiedPages) merged.addPage(page);
  }

  return Buffer.from(await merged.save());
}

/**
 * Splits a PDF into several PDFs, one per `[start, end]` page range (1-based,
 * inclusive — matching how a human would describe "pages 1-3"). Returns an
 * array of Buffers in the same order as `ranges`.
 */
async function splitPdf(bytes, ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    throw new Error('splitPdf needs at least one page range.');
  }

  const source = await loadPdf(bytes);
  const pageCount = source.getPageCount();

  const results = [];
  for (const range of ranges) {
    const [start, end] = range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > pageCount) {
      throw new Error(`Invalid page range [${start}, ${end}] for a ${pageCount}-page PDF.`);
    }

    const out = await PDFDocument.create();
    // pdf-lib page indices are 0-based; ranges here are 1-based inclusive.
    const pageIndices = [];
    for (let i = start; i <= end; i++) pageIndices.push(i - 1);
    const copiedPages = await out.copyPages(source, pageIndices);
    for (const page of copiedPages) out.addPage(page);

    results.push(Buffer.from(await out.save()));
  }

  return results;
}

module.exports = {
  getPageCount,
  mergePdfs,
  splitPdf,
  MAX_INPUT_PDFS
};
