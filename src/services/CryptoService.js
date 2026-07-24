import crypto from 'crypto';

// ---- Parameters -----------------------------------------------------------
// AES-256-GCM: 256-bit key, 96-bit (12 byte) IV is the NIST-recommended size
// for GCM, 128-bit (16 byte) authentication tag.
export const ALGORITHM = 'aes-256-gcm';
export const KEY_LENGTH = 32; // 256 bits
export const IV_LENGTH = 12; // 96 bits, recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
export const SALT_LENGTH = 32; // 256 bits
export const PBKDF2_ITERATIONS = 210000; // OWASP 2023+ recommendation for PBKDF2-HMAC-SHA256
const PBKDF2_DIGEST = 'sha256';

/**
 * Generates a cryptographically random salt for key derivation.
 * @returns {Buffer}
 */
export function generateSalt() {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * Derives a 256-bit AES key from a master password and salt using PBKDF2.
 * @param {string} password
 * @param {Buffer} salt
 * @returns {Buffer} 32-byte derived key
 */
export function deriveKey(password, salt) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  if (!Buffer.isBuffer(salt)) {
    throw new Error('Salt must be a Buffer');
  }
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

/**
 * Encrypts a plaintext string with AES-256-GCM using the given key.
 * A fresh random IV is generated for every call (required - IVs must
 * never be reused with the same key under GCM).
 * @param {string} plaintext
 * @param {Buffer} key 32-byte derived key
 * @returns {{ iv: string, authTag: string, ciphertext: string }} base64-encoded parts
 */
export function encrypt(plaintext, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
    throw new Error('Encryption key must be a 32-byte Buffer');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

/**
 * Decrypts a payload produced by encrypt(). Throws if the key is wrong or
 * the data has been tampered with (GCM authentication failure).
 * @param {{ iv: string, authTag: string, ciphertext: string }} payload
 * @param {Buffer} key 32-byte derived key
 * @returns {string} plaintext
 */
export function decrypt(payload, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
    throw new Error('Decryption key must be a 32-byte Buffer');
  }
  const { iv, authTag, ciphertext } = payload || {};
  // Presence checks, not truthiness checks: encrypting an empty string
  // legitimately produces an empty (falsy) base64 ciphertext, which a
  // `!ciphertext` check would wrongly reject as "malformed".
  if (iv === undefined || authTag === undefined || ciphertext === undefined) {
    throw new Error('Malformed encrypted payload');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  try {
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    // GCM tag mismatch throws here - almost always means wrong password
    // or corrupted/tampered vault file.
    throw new Error('Decryption failed: incorrect master password or corrupted vault');
  }
}

/**
 * Encrypts a JS object as JSON.
 */
export function encryptObject(obj, key) {
  return encrypt(JSON.stringify(obj), key);
}

/**
 * Decrypts a payload and parses it as JSON.
 */
export function decryptObject(payload, key) {
  return JSON.parse(decrypt(payload, key));
}

/**
 * Verifies a password against a stored salt + a known-good encrypted probe
 * payload without throwing - returns a boolean.
 */
export function verifyPassword(password, salt, probePayload) {
  try {
    const key = deriveKey(password, salt);
    decrypt(probePayload, key);
    return true;
  } catch {
    return false;
  }
}
