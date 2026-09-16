const zxcvbn = require('zxcvbn');

/**
 * Password policy
 *
 * Previously length-only (>= 8 chars), which accepts weak-but-long passwords
 * (e.g. "aaaaaaaa") and rejects strong short ones for no real security
 * benefit. zxcvbn scores a password 0 (weakest) to 4 (strongest) using the
 * same pattern/dictionary/keyboard-walk heuristics real crackers use, so it
 * catches predictable passwords (including ones built from the user's own
 * name/email, passed in via `userInputs`) that a plain character-class rule
 * would happily accept.
 *
 * MIN_SCORE 3 requires an estimated crack time in the "months to years"
 * range under offline attack — strong enough for accounts holding privileged
 * legal documents without being so strict ordinary passphrases get rejected.
 *
 * Follow-up (explicitly out of scope for this pass): check the password
 * against a known-breach corpus (e.g. Have I Been Pwned's k-anonymity API)
 * in addition to this strength score.
 */

const MIN_LENGTH = 8;
const MIN_SCORE = 3;

/**
 * @param {string} password
 * @param {string[]} [userInputs] values (email, name, etc.) zxcvbn should
 *   penalize the password for containing, since they're the first thing an
 *   attacker targeting this specific account would try.
 * @returns {{ valid: boolean, message?: string }}
 */
function validatePassword(password, userInputs = []) {
  if (!password || typeof password !== 'string' || password.length < MIN_LENGTH) {
    return { valid: false, message: `Password must be at least ${MIN_LENGTH} characters.` };
  }

  const result = zxcvbn(password, userInputs.filter(Boolean));
  if (result.score < MIN_SCORE) {
    const feedback = [result.feedback && result.feedback.warning, ...(result.feedback?.suggestions || [])]
      .filter(Boolean)
      .join(' ');
    return {
      valid: false,
      message: feedback
        ? `Password is too weak. ${feedback}`
        : 'Password is too weak. Use a longer or less predictable password — mix uppercase, lowercase, numbers, and symbols, and avoid common words or patterns.'
    };
  }

  return { valid: true };
}

module.exports = { validatePassword, MIN_LENGTH, MIN_SCORE };
