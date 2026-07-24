import * as FileService from './FileService.js';
import * as CryptoService from './CryptoService.js';

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 12;

/**
 * PIN-based quick unlock is a *convenience* layer only - the master
 * password remains the vault's real encryption key. Enabling it wraps
 * the already-derived session key (not the master password) using the
 * OS's own credential protection (Keychain on macOS, libsecret on Linux,
 * DPAPI on Windows, via Electron's `safeStorage`), which can only be
 * decrypted by the same OS user account. The PIN itself is checked
 * separately (a stored PBKDF2 verifier, never the encryption key for
 * anything) purely as a local "did you type the right PIN" UX gate -
 * it adds no cryptographic protection beyond the OS-account boundary,
 * which is the actual security boundary here. That's a deliberate
 * tradeoff: a short numeric PIN doesn't have enough entropy to be a real
 * key on its own, so the design leans entirely on the OS to protect the
 * wrapped key at rest instead of pretending the PIN does.
 */

export function isAvailable(safeStorage) {
  return !!safeStorage && safeStorage.isEncryptionAvailable();
}

export function isEnabled(quickUnlockFilePath) {
  return FileService.pathExists(quickUnlockFilePath);
}

function validatePin(pin) {
  if (typeof pin !== 'string' || !/^\d+$/.test(pin) || pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    throw new Error(`PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`);
  }
}

/**
 * Wraps the current session key (+ its salt) under the OS credential
 * store, gated behind a PIN verifier. Overwrites any previous quick
 * unlock setup.
 */
export function enable(quickUnlockFilePath, safeStorage, pin, sessionKey, salt) {
  validatePin(pin);
  if (!isAvailable(safeStorage)) {
    throw new Error('Quick unlock is not available on this system');
  }

  const verifierSalt = CryptoService.generateSalt();
  const verifierHash = CryptoService.deriveKey(pin, verifierSalt);
  const wrapped = safeStorage.encryptString(
    JSON.stringify({ salt: salt.toString('base64'), sessionKey: sessionKey.toString('base64') }),
  );

  FileService.writeJsonFileAtomic(quickUnlockFilePath, {
    verifierSalt: verifierSalt.toString('base64'),
    verifierHash: verifierHash.toString('base64'),
    wrapped: wrapped.toString('base64'),
  });
}

export function disable(quickUnlockFilePath) {
  FileService.deleteFile(quickUnlockFilePath);
}

/**
 * Verifies the PIN and unwraps the session key. Throws on a wrong PIN,
 * a missing/corrupt quick-unlock file, or an unavailable OS credential
 * store (e.g. the file was copied to a different machine/user account -
 * safeStorage simply can't decrypt data it didn't encrypt).
 * @returns {{ sessionKey: Buffer, salt: Buffer }}
 */
export function unlock(quickUnlockFilePath, safeStorage, pin) {
  const record = FileService.readJsonFile(quickUnlockFilePath);
  if (!record) {
    throw new Error('Quick unlock is not set up');
  }
  if (!isAvailable(safeStorage)) {
    throw new Error('Quick unlock is not available on this system');
  }

  const verifierSalt = Buffer.from(record.verifierSalt, 'base64');
  const expectedHash = Buffer.from(record.verifierHash, 'base64');
  const candidateHash = CryptoService.deriveKey(pin, verifierSalt);
  if (candidateHash.length !== expectedHash.length || Buffer.compare(candidateHash, expectedHash) !== 0) {
    throw new Error('Incorrect PIN');
  }

  let decrypted;
  try {
    decrypted = safeStorage.decryptString(Buffer.from(record.wrapped, 'base64'));
  } catch {
    throw new Error('Could not unwrap quick unlock data - it may belong to a different device or user account');
  }
  const { salt: saltB64, sessionKey: sessionKeyB64 } = JSON.parse(decrypted);
  return { sessionKey: Buffer.from(sessionKeyB64, 'base64'), salt: Buffer.from(saltB64, 'base64') };
}
