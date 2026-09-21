/**
 * Local Tesseract OCR provider — the only provider this app actually calls
 * today. Runs entirely on this machine via tesseract.js (WASM build of the
 * Tesseract engine), no account, no API key, no network call.
 *
 * A real cloud provider (e.g. googleVisionProvider.js, textractProvider.js)
 * would live next to this file and implement the same one method, calling
 * out to that service's API instead of spinning up a local worker; see
 * ../providerSelector.js for how one gets selected. The `recognizeImage`
 * shape (an image buffer in, `{ text, confidence }` out) is deliberately
 * the smallest surface a cloud OCR API can be adapted to.
 *
 * Each call gets its own tesseract.js worker, used once and terminated —
 * not a shared/pooled worker. This mirrors the documented reasoning in
 * documentTextExtractor.js's withTimeout comment: a persistent worker POOL
 * would be the more efficient design, but this codebase has already
 * reproduced worker-thread creation itself being unstable under this
 * project's concurrent test suite (many test files opening resources
 * together), so a worker is only ever spun up for the lifetime of one
 * recognize() call, never shared across calls or requests.
 */

const baseLogger = require('../../../utils/logger');

function getOcrTimeoutMs() {
  return parseInt(process.env.OCR_TIMEOUT_MS, 10) || 30000;
}

// Races a promise against a timer, same shape as documentTextExtractor's
// withTimeout. Unlike pdf-parse (see that file's long comment on why a
// timeout can't actually bound it), tesseract.js's recognize() runs on a
// real worker_thread, so terminate()ing that worker from the outside is a
// genuine, provable way to stop a run that's exceeded its budget — not a
// best-effort measure that quietly does nothing.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = {
  name: 'tesseract',

  /**
   * OCRs a single image (PNG/JPEG buffer). Always resolves or throws a
   * plain Error with a human-readable message — callers decide how to
   * surface that, same convention as the e-signature/KMS providers.
   */
  async recognizeImage(buffer, { log = baseLogger, timeoutMs = getOcrTimeoutMs() } = {}) {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const { data } = await withTimeout(worker.recognize(buffer), timeoutMs, 'OCR');
      return { text: data.text || '', confidence: typeof data.confidence === 'number' ? data.confidence : null };
    } catch (err) {
      log.error('tesseract OCR failed', { context: 'OCR', error: err.message });
      throw err;
    } finally {
      // terminate() kills the underlying worker_thread regardless of
      // whether recognize() finished, timed out, or threw — the same
      // "kill it from the outside" mechanism the pdf-parse comment
      // identifies as the correct fix, applied here because tesseract.js
      // actually offers it per-call.
      await worker.terminate().catch(() => {});
    }
  }
};
