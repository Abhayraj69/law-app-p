const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { getPageCount, mergePdfs, splitPdf } = require('../services/pdfTools');

// Pure pdf-lib, no OCR/worker-thread involved, so — unlike the OCR tests —
// this runs as a normal part of the default suite with no gating.

async function makePdf(pageCount, label) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([200, 200]);
    page.drawText(`${label} page ${i + 1}`, { x: 10, y: 100 });
  }
  return Buffer.from(await doc.save());
}

test('pdfTools: getPageCount', async () => {
  const pdf = await makePdf(3, 'A');
  assert.equal(await getPageCount(pdf), 3);
});

test('pdfTools: getPageCount rejects a non-PDF buffer', async () => {
  await assert.rejects(() => getPageCount(Buffer.from('not a pdf')), /Could not read this file as a PDF/);
});

test('pdfTools: mergePdfs concatenates pages in order', async () => {
  const a = await makePdf(2, 'A');
  const b = await makePdf(3, 'B');
  const merged = await mergePdfs([a, b]);
  assert.equal(await getPageCount(merged), 5);
});

test('pdfTools: mergePdfs rejects an empty list', async () => {
  await assert.rejects(() => mergePdfs([]), /at least one PDF/);
});

test('pdfTools: splitPdf returns one PDF per requested range, correctly sized', async () => {
  const pdf = await makePdf(6, 'A');
  const [first, second] = await splitPdf(pdf, [[1, 2], [3, 6]]);
  assert.equal(await getPageCount(first), 2);
  assert.equal(await getPageCount(second), 4);
});

test('pdfTools: splitPdf rejects an out-of-bounds range', async () => {
  const pdf = await makePdf(3, 'A');
  await assert.rejects(() => splitPdf(pdf, [[1, 10]]), /Invalid page range/);
});

test('pdfTools: splitPdf rejects an inverted range', async () => {
  const pdf = await makePdf(3, 'A');
  await assert.rejects(() => splitPdf(pdf, [[3, 1]]), /Invalid page range/);
});

test('pdfTools: merge then split round-trips page count', async () => {
  const a = await makePdf(2, 'A');
  const b = await makePdf(4, 'B');
  const merged = await mergePdfs([a, b]);
  const [back] = await splitPdf(merged, [[1, 6]]);
  assert.equal(await getPageCount(back), 6);
});
