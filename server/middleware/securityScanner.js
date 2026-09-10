const path = require('path');

/**
 * MIME Type Validation & Malware Scanning Middleware
 * Enforces strict whitelist of legal document types (.pdf, .doc, .docx, .xls, .xlsx, .png, .jpg)
 * and executes a virus scan interface prior to saving or processing uploads.
 */

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg'
];

/**
 * Mock Malware Engine Interface (e.g., ClamAV stream scanner / AWS GuardDuty Malicious File Scan)
 */
async function scanFileForMalware(fileName, bufferOrPath) {
  // Simulating asynchronous virus definitions scan
  return new Promise((resolve) => {
    setTimeout(() => {
      // Mock condition: reject files containing 'eicar' or 'malware' or '.exe' in name
      const lowerName = (fileName || '').toLowerCase();
      if (lowerName.includes('eicar') || lowerName.includes('virus') || lowerName.includes('malware') || lowerName.endsWith('.exe')) {
        return resolve({ clean: false, virusName: 'Win32.EICAR-Test-Signature' });
      }
      return resolve({ clean: true });
    }, 50);
  });
}

async function validateAndScanUpload(req, res, next) {
  // If request contains file metadata or uploaded files
  const filesToValidate = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : (req.body && req.body.fileName ? [{ originalname: req.body.fileName, mimetype: req.body.fileType }] : []);

  for (const file of filesToValidate) {
    const filename = file.originalname || file.name || req.body.fileName || '';
    const ext = path.extname(filename).toLowerCase();
    const mime = file.mimetype || file.type || req.body.fileType || '';

    // 1. Extension & MIME Validation
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({
        error: `Unsupported file type '${ext}'. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`,
        code: 'INVALID_FILE_EXTENSION'
      });
    }

    if (mime && !ALLOWED_MIME_TYPES.includes(mime)) {
      return res.status(400).json({
        error: `MIME type '${mime}' is not permitted for upload in Document Vault.`,
        code: 'INVALID_MIME_TYPE'
      });
    }

    // 2. Virus & Malware Scan Check
    const scanResult = await scanFileForMalware(filename, file.buffer || file.path);
    if (!scanResult.clean) {
      return res.status(422).json({
        error: `Security Violation: File '${filename}' failed malware scan. Infection detected: ${scanResult.virusName}`,
        code: 'MALWARE_DETECTED'
      });
    }
  }

  next();
}

module.exports = {
  validateAndScanUpload,
  scanFileForMalware,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES
};
