const path = require('path');
const net = require('net');

/**
 * Upload Validation & Malware Scanning Middleware
 *
 * Previously this "scanned" files by checking whether the filename
 * contained the word "virus"/"malware" or ended in ".exe" — it never
 * looked at file content, so any real malicious file with a normal name
 * sailed straight through. It also validated MIME type against whatever
 * the client claimed in the request body, which a client fully controls.
 *
 * This version:
 *   1. Validates the extension against an allowlist (unchanged intent).
 *   2. Verifies the file's actual content matches that extension via
 *      binary signature ("magic bytes") checks — a real, content-based
 *      control that catches a renamed executable or a mismatched file
 *      type, which the old extension/client-MIME check could not.
 *   3. Scans the content with ClamAV over its INSTREAM protocol if
 *      CLAMAV_HOST is configured. If no scanner is configured, uploads
 *      are still accepted (this is a prototype, not a hardened intake
 *      pipeline) but the audit trail and API response clearly say only
 *      basic signature validation ran — never claim a "malware scan
 *      passed" when no antivirus engine actually ran one.
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

// Binary signature checks, keyed by extension. Each returns true if the
// buffer's leading bytes are consistent with that file format.
const SIGNATURE_CHECKS = {
  '.pdf': (buf) => buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-',
  '.png': (buf) => buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  '.jpeg': (buf) => SIGNATURE_CHECKS['.jpg'](buf),
  // Legacy OLE Compound File format underlies old .doc / .xls
  '.doc': (buf) => buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  '.xls': (buf) => SIGNATURE_CHECKS['.doc'](buf),
  // Modern .docx / .xlsx are ZIP (OOXML) containers — this confirms it's
  // genuinely a ZIP, which rules out e.g. an executable or script renamed
  // with an Office extension. It does not deep-inspect the ZIP's internal
  // parts to distinguish a docx from an xlsx from a plain zip.
  '.docx': (buf) => buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07),
  '.xlsx': (buf) => SIGNATURE_CHECKS['.docx'](buf),
};

// A handful of unambiguous "this is not a document" signatures, checked
// regardless of the claimed extension.
function looksLikeExecutable(buf) {
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return true; // "MZ" — Windows PE
  if (buf.length >= 4 && buf.slice(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true; // ELF
  if (buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21) return true; // "#!" shebang script
  return false;
}

function checkSignature(ext, buffer) {
  const check = SIGNATURE_CHECKS[ext];
  if (!check) return { ok: true, checked: false }; // no signature rule for this ext — allowlist already gates it
  return { ok: check(buffer), checked: true };
}

/**
 * Scan a buffer with ClamAV via its INSTREAM protocol, if configured.
 * Resolves { available: false } if CLAMAV_HOST isn't set or the daemon
 * can't be reached (never throws — a missing scanner degrades to
 * signature-only validation rather than blocking every upload).
 */
function scanWithClamAv(buffer) {
  const host = process.env.CLAMAV_HOST;
  const port = parseInt(process.env.CLAMAV_PORT, 10) || 3310;

  if (!host) return Promise.resolve({ available: false });

  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let response = Buffer.alloc(0);
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(4000, () => finish({ available: false, error: 'ClamAV connection timed out' }));
    socket.on('error', (err) => finish({ available: false, error: err.message }));

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      // Stream the file as a single chunk (fine for the 50MB cap enforced
      // upstream), preceded by its 4-byte big-endian length, terminated
      // by a zero-length chunk per the clamd protocol.
      const sizeHeader = Buffer.alloc(4);
      sizeHeader.writeUInt32BE(buffer.length, 0);
      socket.write(sizeHeader);
      socket.write(buffer);
      socket.write(Buffer.alloc(4)); // zero-length terminator chunk
    });

    socket.on('data', (chunk) => {
      response = Buffer.concat([response, chunk]);
    });

    socket.on('end', () => {
      const text = response.toString('utf8');
      if (/FOUND/.test(text)) {
        const match = /stream:\s*(.+?)\s*FOUND/.exec(text);
        finish({ available: true, clean: false, virusName: match ? match[1] : 'Unknown' });
      } else if (/OK/.test(text)) {
        finish({ available: true, clean: true });
      } else {
        finish({ available: false, error: `Unexpected ClamAV response: ${text.trim()}` });
      }
    });
  });
}

async function validateAndScanUpload(req, res, next) {
  try {
    // multer (memoryStorage) populates req.file for the multipart upload
    // route. Fall back to a metadata-only shape for any other caller so
    // this middleware doesn't crash if reused elsewhere.
    const file = req.file || null;

    if (!file) {
      return res.status(400).json({
        error: 'No file was received. Upload requests must send multipart/form-data with a "file" field.',
        code: 'NO_FILE'
      });
    }

    const filename = file.originalname || '';
    const ext = path.extname(filename).toLowerCase();
    const claimedMime = file.mimetype || '';

    // 1. Extension allowlist
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({
        error: `Unsupported file type '${ext}'. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`,
        code: 'INVALID_FILE_EXTENSION'
      });
    }

    // 2. Client-claimed MIME allowlist (informational — see step 3 for the
    // real content-based check; a client can lie about this header).
    if (claimedMime && !ALLOWED_MIME_TYPES.includes(claimedMime)) {
      return res.status(400).json({
        error: `MIME type '${claimedMime}' is not permitted for upload in Document Vault.`,
        code: 'INVALID_MIME_TYPE'
      });
    }

    // 3. Content-based signature check — this is the control that actually
    // prevents a renamed executable or mismatched file type from passing,
    // which trusting the extension/MIME alone could not.
    if (looksLikeExecutable(file.buffer)) {
      return res.status(422).json({
        error: `Security violation: '${filename}' content matches an executable/script format, not a document.`,
        code: 'DISALLOWED_CONTENT'
      });
    }
    const sig = checkSignature(ext, file.buffer);
    if (sig.checked && !sig.ok) {
      return res.status(422).json({
        error: `Security violation: '${filename}' content does not match its '${ext}' extension.`,
        code: 'SIGNATURE_MISMATCH'
      });
    }

    // 4. Real antivirus scan if ClamAV is configured; otherwise proceed
    // with signature validation only, and say so honestly in the audit
    // trail rather than implying a scan happened.
    const scan = await scanWithClamAv(file.buffer);
    if (scan.available && !scan.clean) {
      return res.status(422).json({
        error: `Security violation: '${filename}' failed malware scan. Infection detected: ${scan.virusName}`,
        code: 'MALWARE_DETECTED'
      });
    }

    req.uploadValidation = {
      signature_checked: sig.checked,
      antivirus_engine: scan.available ? 'clamav' : 'none',
      antivirus_note: scan.available
        ? 'clean'
        : 'No antivirus engine configured (set CLAMAV_HOST) — only file-extension and content-signature checks ran.'
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  validateAndScanUpload,
  scanWithClamAv,
  checkSignature,
  looksLikeExecutable,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES
};
