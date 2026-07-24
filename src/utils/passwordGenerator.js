const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const AMBIGUOUS = /[Il1O0o]/;

/**
 * Generates a random password in the browser using the Web Crypto API
 * (crypto.getRandomValues), which is available in the Electron renderer
 * without any IPC round-trip.
 * @param {Object} options - typically vault settings.passwordGenerator
 */
export function generatePassword(options = {}) {
  const {
    length = 20,
    uppercase = true,
    lowercase = true,
    numbers = true,
    symbols = true,
    excludeAmbiguous = false,
  } = options;

  let pool = '';
  if (lowercase) pool += LOWER;
  if (uppercase) pool += UPPER;
  if (numbers) pool += NUMBERS;
  if (symbols) pool += SYMBOLS;

  if (excludeAmbiguous) {
    pool = pool
      .split('')
      .filter((c) => !AMBIGUOUS.test(c))
      .join('');
  }

  if (!pool) {
    throw new Error('At least one character set must be enabled');
  }

  const randomValues = new Uint32Array(length);
  window.crypto.getRandomValues(randomValues);

  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += pool[randomValues[i] % pool.length];
  }
  return result;
}
