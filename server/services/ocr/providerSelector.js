const tesseractProvider = require('./providers/tesseractProvider');

/**
 * Picks the OCR backend used to read scanned PDFs/images, the same
 * pluggable-provider shape server/services/esignature/providerSelector.js
 * and server/services/encryption/keyProvider.js use: a provider is a small
 * object exposing `recognizeImage(buffer, options)`, and ocrService never
 * knows which one it's talking to. Only 'tesseract' (local, no API key)
 * exists today — set OCR_PROVIDER once a real cloud provider module (e.g.
 * providers/googleVisionProvider.js) is added here to swap it in without
 * touching ocrService itself.
 */
const PROVIDERS = { tesseract: tesseractProvider };

function getOcrProvider() {
  const name = (process.env.OCR_PROVIDER || 'tesseract').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown OCR_PROVIDER "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

module.exports = { getOcrProvider };
