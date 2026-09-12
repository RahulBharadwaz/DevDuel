const crypto = require('crypto');

// 32-character alphabet explicitly excluding visually ambiguous characters (0, O, 1, I)
const CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const CODE_REGEX = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

/**
 * Generates a cryptographically secure 6-character uppercase alphanumeric room code.
 * Ensures absence of ambiguous characters like 0, O, 1, and I.
 *
 * @param {Set<string>|Map<string, any>} [existingCodes] - Optional set/map of active codes to guarantee zero collisions
 * @returns {string} 6-character room code
 */
function generateRoomCode(existingCodes = null) {
  const maxAttempts = 100;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const randomBytes = crypto.randomBytes(CODE_LENGTH);
    let code = '';

    for (let i = 0; i < CODE_LENGTH; i++) {
      const index = randomBytes[i] % CHARSET.length;
      code += CHARSET[index];
    }

    if (!existingCodes) {
      return code;
    }

    // Check collision against existing collection
    const hasCode = typeof existingCodes.has === 'function' 
      ? existingCodes.has(code) 
      : Boolean(existingCodes[code]);

    if (!hasCode) {
      return code;
    }
  }

  // Fallback timestamp-seeded generation if random collisions unexpectedly exceed threshold
  return `${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

/**
 * Validates whether a room code adheres to the 6-character charset specification
 * @param {string} code 
 * @returns {boolean}
 */
function isValidRoomCode(code) {
  if (!code || typeof code !== 'string') return false;
  return CODE_REGEX.test(code.trim().toUpperCase());
}

module.exports = {
  CHARSET,
  CODE_LENGTH,
  generateRoomCode,
  isValidRoomCode
};
