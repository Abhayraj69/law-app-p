const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

const ocrService = require('../services/ocrService');
const tesseractProvider = require('../services/ocr/providers/tesseractProvider');
const { extractText } = require('../services/documentTextExtractor');

// Most of these tests stub tesseractProvider.recognizeImage rather than
// running the real Tesseract engine. Two reasons, not one:
//   1. Speed — spinning up a real tesseract.js worker takes real seconds,
//      per call, and these tests want to exercise page-cap/truncation/error
//      logic, not prove the engine itself works.
//   2. Safety — tesseract.js's worker runs on a real Node worker_thread,
//      and documentTextExtractor.js's own withTimeout comment documents
//      that spawning worker threads was reproduced to crash this repo's
//      concurrent `node --test server/test/*.test.js` run (many test files'
//      Postgres pools + a worker thread, 4/4 reproduced). A real OCR call
//      belongs behind an opt-in flag (see the gated test at the bottom of
//      this file), not in every default test run.
//
// tesseractProvider is a module-singleton object (required once, cached),
// and ocrService looks up `provider.recognizeImage(...)` on that same
// object at call time — so mocking the method here really does intercept
// what ocrService calls, with no need to touch ocrService itself.

const STORAGE_ROOT = path.join(__dirname, '..', '..', 'storage', 'uploads');
const TEST_SUBDIR = 'test-ocr-scratch';

async function writeTestFile(fileName, bytes) {
  const dir = path.join(STORAGE_ROOT, TEST_SUBDIR);
  await fs.mkdir(dir, { recursive: true });
  const relPath = path.posix.join(TEST_SUBDIR, fileName);
  await fs.writeFile(path.join(STORAGE_ROOT, relPath), bytes);
  return relPath;
}

test.after(async () => {
  await fs.rm(path.join(STORAGE_ROOT, TEST_SUBDIR), { recursive: true, force: true });
});

async function makePdf(pageCount) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

test('ocrService.ocrImage returns the provider\'s text and confidence', async (t) => {
  t.mock.method(tesseractProvider, 'recognizeImage', async () => ({ text: 'HELLO WORLD', confidence: 87 }));
  const result = await ocrService.ocrImage(Buffer.from('fake-image-bytes'));
  assert.equal(result.text, 'HELLO WORLD');
  assert.equal(result.confidence, 87);
});

test('ocrService.ocrImage propagates a provider failure', async (t) => {
  t.mock.method(tesseractProvider, 'recognizeImage', async () => { throw new Error('provider exploded'); });
  await assert.rejects(() => ocrService.ocrImage(Buffer.from('x')), /provider exploded/);
});

test('ocrService.ocrScannedPdf OCRs every page of a PDF within the cap', async (t) => {
  let calls = 0;
  t.mock.method(tesseractProvider, 'recognizeImage', async () => {
    calls += 1;
    return { text: `page ${calls}`, confidence: 90 };
  });

  const pdf = await makePdf(3);
  const result = await ocrService.ocrScannedPdf(pdf);

  assert.equal(calls, 3);
  assert.equal(result.page_count, 3);
  assert.equal(result.pages_ocred, 3);
  assert.equal(result.truncated_pages, false);
  assert.match(result.text, /page 1/);
  assert.match(result.text, /page 3/);
});

test('ocrService.ocrScannedPdf caps pages at OCR_MAX_PAGES and reports truncation', async (t) => {
  const originalMax = process.env.OCR_MAX_PAGES;
  process.env.OCR_MAX_PAGES = '2';
  t.after(() => {
    if (originalMax === undefined) delete process.env.OCR_MAX_PAGES;
    else process.env.OCR_MAX_PAGES = originalMax;
  });

  let calls = 0;
  t.mock.method(tesseractProvider, 'recognizeImage', async () => {
    calls += 1;
    return { text: `page ${calls}`, confidence: 90 };
  });

  const pdf = await makePdf(5);
  const result = await ocrService.ocrScannedPdf(pdf);

  assert.equal(calls, 2, 'only the capped number of pages should ever be rasterized/OCRed');
  assert.equal(result.page_count, 5, 'the true page count is still reported');
  assert.equal(result.pages_ocred, 2);
  assert.equal(result.truncated_pages, true);
});

test('ocrService.ocrScannedPdf skips blank OCR results rather than joining empty strings', async (t) => {
  t.mock.method(tesseractProvider, 'recognizeImage', async () => ({ text: '   ', confidence: 10 }));
  const pdf = await makePdf(2);
  const result = await ocrService.ocrScannedPdf(pdf);
  assert.equal(result.text, '');
});

// ─────────────────────────────────────────────────────────────────────
// documentTextExtractor wiring — proves the OCR fallback is actually
// reached for images and text-layer-less PDFs, still using the stubbed
// provider so no real worker thread is spawned here either.
// ─────────────────────────────────────────────────────────────────────

test('documentTextExtractor: an image extension routes through OCR instead of being refused', async (t) => {
  t.mock.method(tesseractProvider, 'recognizeImage', async () => ({ text: 'IN THE HIGH COURT', confidence: 95 }));
  const relPath = await writeTestFile('scan.png', Buffer.from('not-a-real-png-but-bytes-exist'));

  const result = await extractText({ id: 'test-doc-1', file_name: 'scan.png', storage_path_url: relPath });

  assert.equal(result.extractable, true);
  assert.equal(result.source, 'image-ocr');
  assert.match(result.text, /IN THE HIGH COURT/);
  assert.equal(result.ocr_confidence, 95);
});

test('documentTextExtractor: an image with no readable text is reported, not returned as empty', async (t) => {
  t.mock.method(tesseractProvider, 'recognizeImage', async () => ({ text: '', confidence: 0 }));
  const relPath = await writeTestFile('blank.jpg', Buffer.from('bytes'));

  const result = await extractText({ id: 'test-doc-2', file_name: 'blank.jpg', storage_path_url: relPath });

  assert.equal(result.extractable, false);
  assert.equal(result.text, null);
  assert.match(result.reason, /OCR found no readable text/);
});

test('documentTextExtractor: an OCR provider failure on an image is reported as a reason, not thrown', async (t) => {
  t.mock.method(tesseractProvider, 'recognizeImage', async () => { throw new Error('engine crashed'); });
  const relPath = await writeTestFile('broken.png', Buffer.from('bytes'));

  const result = await extractText({ id: 'test-doc-3', file_name: 'broken.png', storage_path_url: relPath });

  assert.equal(result.extractable, false);
  assert.match(result.reason, /could not be read by OCR/);
  assert.match(result.reason, /engine crashed/);
});

test('documentTextExtractor: a PDF with no text layer falls back to OCR', async (t) => {
  t.mock.method(tesseractProvider, 'recognizeImage', async () => ({ text: 'SCANNED ORDER TEXT', confidence: 92 }));
  const pdf = await makePdf(1); // blank page => pdf-parse finds no text layer
  const relPath = await writeTestFile('scanned-order.pdf', pdf);

  const result = await extractText({ id: 'test-doc-4', file_name: 'scanned-order.pdf', storage_path_url: relPath });

  assert.equal(result.extractable, true);
  assert.equal(result.source, 'pdf-ocr');
  assert.match(result.text, /SCANNED ORDER TEXT/);
  assert.equal(result.pages_ocred, 1);
});

// ─────────────────────────────────────────────────────────────────────
// Real Tesseract, gated — proves the actual engine (not a stub) can read
// real text out of a real rasterized image. Opt-in only: set RUN_OCR_TESTS
// to run it, since it spawns a real tesseract.js worker_thread and this
// repo has already reproduced worker-thread creation being unstable when
// many concurrent test files are also running (see the comment at the top
// of this file / documentTextExtractor's withTimeout comment).
// ─────────────────────────────────────────────────────────────────────

test('ocrService.ocrImage reads real text with the real Tesseract engine', {
  skip: !process.env.RUN_OCR_TESTS && 'set RUN_OCR_TESTS=1 to run real Tesseract OCR (spawns a worker thread; run this file alone, not the full concurrent suite)'
}, async () => {
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(600, 150);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 600, 150);
  ctx.fillStyle = 'black';
  ctx.font = '30px sans-serif';
  ctx.fillText('KARNATAKA HIGH COURT', 20, 80);
  const png = canvas.toBuffer('image/png');

  const result = await ocrService.ocrImage(png);
  assert.match(result.text, /KARNATAKA/i);
});
