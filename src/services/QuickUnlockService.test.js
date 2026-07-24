import fs from 'fs';
import os from 'os';
import path from 'path';
import * as QuickUnlockService from './QuickUnlockService.js';
import * as CryptoService from './CryptoService.js';

// safeStorage is a real Electron API (OS keychain/DPAPI/libsecret) that
// doesn't exist under plain Node/Jest - this fake mimics its Buffer-in,
// Buffer/string-out contract closely enough to exercise the wrap/unwrap
// logic without needing a real OS credential store.
function createFakeSafeStorage({ available = true } = {}) {
  const store = new Map();
  let counter = 0;
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plaintext) => {
      const id = `enc-${counter++}`;
      store.set(id, plaintext);
      return Buffer.from(id, 'utf8');
    },
    decryptString: (buf) => {
      const id = buf.toString('utf8');
      if (!store.has(id)) throw new Error('This ciphertext was not produced by this fake store');
      return store.get(id);
    },
  };
}

function tempQuickUnlockPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-quickunlock-test-'));
  return path.join(dir, 'quickunlock.dat');
}

describe('isAvailable', () => {
  test('reflects safeStorage.isEncryptionAvailable()', () => {
    expect(QuickUnlockService.isAvailable(createFakeSafeStorage({ available: true }))).toBe(true);
    expect(QuickUnlockService.isAvailable(createFakeSafeStorage({ available: false }))).toBe(false);
  });

  test('false when no safeStorage is provided', () => {
    expect(QuickUnlockService.isAvailable(null)).toBe(false);
  });
});

describe('enable / isEnabled / disable', () => {
  test('isEnabled reflects whether the quick-unlock file exists', () => {
    const filePath = tempQuickUnlockPath();
    const safeStorage = createFakeSafeStorage();
    expect(QuickUnlockService.isEnabled(filePath)).toBe(false);

    QuickUnlockService.enable(filePath, safeStorage, '1234', Buffer.from('session-key-32-bytes-long-000000'), Buffer.from('salt'));
    expect(QuickUnlockService.isEnabled(filePath)).toBe(true);

    QuickUnlockService.disable(filePath);
    expect(QuickUnlockService.isEnabled(filePath)).toBe(false);
  });

  test('rejects a non-numeric or out-of-range PIN', () => {
    const filePath = tempQuickUnlockPath();
    const safeStorage = createFakeSafeStorage();
    const key = Buffer.from('session-key-32-bytes-long-000000');
    const salt = Buffer.from('salt');

    expect(() => QuickUnlockService.enable(filePath, safeStorage, 'abcd', key, salt)).toThrow(/digits/i);
    expect(() => QuickUnlockService.enable(filePath, safeStorage, '12', key, salt)).toThrow(/digits/i);
    expect(() => QuickUnlockService.enable(filePath, safeStorage, '1234567890123', key, salt)).toThrow(/digits/i);
  });

  test('throws when safeStorage is unavailable', () => {
    const filePath = tempQuickUnlockPath();
    const safeStorage = createFakeSafeStorage({ available: false });
    expect(() =>
      QuickUnlockService.enable(filePath, safeStorage, '1234', Buffer.from('key'), Buffer.from('salt')),
    ).toThrow(/not available/i);
  });
});

describe('unlock', () => {
  test('round-trips the session key and salt through enable/unlock with the correct PIN', () => {
    const filePath = tempQuickUnlockPath();
    const safeStorage = createFakeSafeStorage();
    const sessionKey = CryptoService.generateSalt(); // any 32-byte buffer works as a stand-in key
    const salt = CryptoService.generateSalt();

    QuickUnlockService.enable(filePath, safeStorage, '4242', sessionKey, salt);
    const recovered = QuickUnlockService.unlock(filePath, safeStorage, '4242');

    expect(recovered.sessionKey.equals(sessionKey)).toBe(true);
    expect(recovered.salt.equals(salt)).toBe(true);
  });

  test('rejects an incorrect PIN without ever calling safeStorage.decryptString', () => {
    const filePath = tempQuickUnlockPath();
    const safeStorage = createFakeSafeStorage();
    const decryptSpy = jest.spyOn(safeStorage, 'decryptString');
    QuickUnlockService.enable(filePath, safeStorage, '4242', CryptoService.generateSalt(), CryptoService.generateSalt());

    expect(() => QuickUnlockService.unlock(filePath, safeStorage, '0000')).toThrow(/incorrect pin/i);
    expect(decryptSpy).not.toHaveBeenCalled();
  });

  test('throws a clear error when quick unlock was never set up', () => {
    const filePath = tempQuickUnlockPath();
    const safeStorage = createFakeSafeStorage();
    expect(() => QuickUnlockService.unlock(filePath, safeStorage, '1234')).toThrow(/not set up/i);
  });

  test('throws when the wrapped data cannot be decrypted (e.g. different device/user)', () => {
    const filePath = tempQuickUnlockPath();
    const enableStorage = createFakeSafeStorage();
    QuickUnlockService.enable(filePath, enableStorage, '4242', CryptoService.generateSalt(), CryptoService.generateSalt());

    // A different safeStorage instance simulates a different OS
    // credential store (e.g. the file was copied to another machine) -
    // its decryptString has no record of enableStorage's ciphertext.
    const otherStorage = createFakeSafeStorage();
    expect(() => QuickUnlockService.unlock(filePath, otherStorage, '4242')).toThrow(/different device/i);
  });
});
