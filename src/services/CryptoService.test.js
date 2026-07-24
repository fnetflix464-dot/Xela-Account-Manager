import {
  KEY_LENGTH,
  SALT_LENGTH,
  IV_LENGTH,
  generateSalt,
  deriveKey,
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
  verifyPassword,
} from './CryptoService.js';

describe('generateSalt', () => {
  test('returns a SALT_LENGTH-byte buffer', () => {
    const salt = generateSalt();
    expect(Buffer.isBuffer(salt)).toBe(true);
    expect(salt.length).toBe(SALT_LENGTH);
  });

  test('returns a different value every call', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a.equals(b)).toBe(false);
  });
});

describe('deriveKey', () => {
  test('is deterministic for the same password + salt', () => {
    const salt = generateSalt();
    const key1 = deriveKey('correct horse battery staple', salt);
    const key2 = deriveKey('correct horse battery staple', salt);
    expect(key1.equals(key2)).toBe(true);
    expect(key1.length).toBe(KEY_LENGTH);
  });

  test('produces a different key for a different password', () => {
    const salt = generateSalt();
    const key1 = deriveKey('correct horse battery staple', salt);
    const key2 = deriveKey('Correct Horse Battery Staple', salt);
    expect(key1.equals(key2)).toBe(false);
  });

  test('produces a different key for a different salt', () => {
    const key1 = deriveKey('same password', generateSalt());
    const key2 = deriveKey('same password', generateSalt());
    expect(key1.equals(key2)).toBe(false);
  });

  test('rejects a non-string password', () => {
    expect(() => deriveKey(12345678, generateSalt())).toThrow();
    expect(() => deriveKey('', generateSalt())).toThrow();
  });

  test('rejects a non-Buffer salt', () => {
    expect(() => deriveKey('password', 'not-a-buffer')).toThrow();
  });
});

describe('encrypt / decrypt', () => {
  let key;

  beforeEach(() => {
    key = deriveKey('test-password', generateSalt());
  });

  test('round-trips plain text', () => {
    const payload = encrypt('hello world', key);
    expect(decrypt(payload, key)).toBe('hello world');
  });

  test('round-trips empty string', () => {
    const payload = encrypt('', key);
    expect(decrypt(payload, key)).toBe('');
  });

  test('round-trips unicode content', () => {
    const text = '🔐 pässwörd データ';
    const payload = encrypt(text, key);
    expect(decrypt(payload, key)).toBe(text);
  });

  test('produces a different IV/ciphertext every call (no IV reuse)', () => {
    const a = encrypt('same plaintext', key);
    const b = encrypt('same plaintext', key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  test('rejects a key of the wrong length', () => {
    expect(() => encrypt('text', Buffer.from('too-short'))).toThrow();
  });

  test('fails to decrypt with the wrong key', () => {
    const payload = encrypt('secret', key);
    const wrongKey = deriveKey('wrong-password', generateSalt());
    expect(() => decrypt(payload, wrongKey)).toThrow(/incorrect master password|corrupted/i);
  });

  test('detects tampered ciphertext (GCM auth failure)', () => {
    const payload = encrypt('secret', key);
    const tampered = { ...payload, ciphertext: Buffer.from('tampered-bytes-here').toString('base64') };
    expect(() => decrypt(tampered, key)).toThrow();
  });

  test('detects a tampered auth tag', () => {
    const payload = encrypt('secret', key);
    const tamperedTag = Buffer.from(payload.authTag, 'base64');
    tamperedTag[0] ^= 0xff;
    const tampered = { ...payload, authTag: tamperedTag.toString('base64') };
    expect(() => decrypt(tampered, key)).toThrow();
  });

  test('rejects a malformed payload missing required fields', () => {
    expect(() => decrypt({ iv: 'x' }, key)).toThrow(/malformed/i);
    expect(() => decrypt(null, key)).toThrow(/malformed/i);
  });
});

describe('encryptObject / decryptObject', () => {
  test('round-trips a nested object', () => {
    const key = deriveKey('password', generateSalt());
    const obj = { a: 1, nested: { b: [1, 2, 3], c: 'text' } };
    const payload = encryptObject(obj, key);
    expect(decryptObject(payload, key)).toEqual(obj);
  });
});

describe('verifyPassword', () => {
  test('returns true for the correct password', () => {
    const salt = generateSalt();
    const key = deriveKey('right-password', salt);
    const probe = encrypt('probe-plaintext', key);
    expect(verifyPassword('right-password', salt, probe)).toBe(true);
  });

  test('returns false for the wrong password (does not throw)', () => {
    const salt = generateSalt();
    const key = deriveKey('right-password', salt);
    const probe = encrypt('probe-plaintext', key);
    expect(verifyPassword('wrong-password', salt, probe)).toBe(false);
  });
});

test('IV length matches the documented NIST-recommended size for GCM', () => {
  expect(IV_LENGTH).toBe(12);
});
