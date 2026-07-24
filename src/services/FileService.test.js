import fs from 'fs';
import os from 'os';
import path from 'path';
import * as FileService from './FileService.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xela-fileservice-test-'));
}

const sampleEnvelope = (overrides = {}) => ({
  salt: 'c2FsdA==',
  iv: 'aXY=',
  authTag: 'dGFn',
  ciphertext: 'Y2lwaGVydGV4dA==',
  ...overrides,
});

describe('writeVaultFile', () => {
  test('writes a file readable back via readVaultFile', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'vault.xam');
    FileService.writeVaultFile(filePath, sampleEnvelope());

    const read = FileService.readVaultFile(filePath);
    expect(read.salt).toBe('c2FsdA==');
    expect(read.ciphertext).toBe('Y2lwaGVydGV4dA==');
    expect(read.fileVersion).toBe(FileService.VAULT_FILE_VERSION);
  });

  test('leaves no .tmp file behind after a successful write', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'vault.xam');
    FileService.writeVaultFile(filePath, sampleEnvelope());

    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  test('creates the file with restrictive (owner-only) permissions', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'vault.xam');
    FileService.writeVaultFile(filePath, sampleEnvelope());

    // Windows doesn't enforce POSIX mode bits the same way - only assert
    // this on platforms where it's meaningful.
    if (process.platform !== 'win32') {
      const mode = fs.statSync(filePath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  test('overwrites an existing vault file with new content', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'vault.xam');
    FileService.writeVaultFile(filePath, sampleEnvelope());
    FileService.writeVaultFile(filePath, sampleEnvelope({ ciphertext: 'dXBkYXRlZA==' }));

    expect(FileService.readVaultFile(filePath).ciphertext).toBe('dXBkYXRlZA==');
  });

  test('a failure while writing the temp file leaves the previous live file completely untouched', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'vault.xam');
    FileService.writeVaultFile(filePath, sampleEnvelope({ ciphertext: 'original-content' }));
    const before = fs.readFileSync(filePath, 'utf8');

    const writeSyncSpy = jest.spyOn(fs, 'writeSync').mockImplementation(() => {
      throw new Error('simulated crash mid-write');
    });

    expect(() => FileService.writeVaultFile(filePath, sampleEnvelope({ ciphertext: 'new-content' }))).toThrow(
      /simulated crash/,
    );
    writeSyncSpy.mockRestore();

    // The live file must be byte-for-byte the same as before the failed
    // write attempt - this is the entire point of writing to a temp file
    // and only renaming over the live file once it's fully synced.
    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
  });

  test('a failure while writing the temp file does not leave an orphaned .tmp file', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'vault.xam');
    FileService.writeVaultFile(filePath, sampleEnvelope());

    const writeSyncSpy = jest.spyOn(fs, 'writeSync').mockImplementation(() => {
      throw new Error('simulated crash mid-write');
    });
    expect(() => FileService.writeVaultFile(filePath, sampleEnvelope())).toThrow();
    writeSyncSpy.mockRestore();

    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  test('a failure during fsync also leaves the previous live file untouched and cleans up the temp file', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'vault.xam');
    FileService.writeVaultFile(filePath, sampleEnvelope({ ciphertext: 'original-content' }));
    const before = fs.readFileSync(filePath, 'utf8');

    const fsyncSpy = jest.spyOn(fs, 'fsyncSync').mockImplementation(() => {
      throw new Error('simulated fsync failure');
    });
    expect(() => FileService.writeVaultFile(filePath, sampleEnvelope({ ciphertext: 'new-content' }))).toThrow(
      /simulated fsync/,
    );
    fsyncSpy.mockRestore();

    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  test('calls fsync before renaming (durability actually happens before the file becomes visible)', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'vault.xam');
    const callOrder = [];
    const realRenameSync = fs.renameSync.bind(fs);

    const fsyncSpy = jest.spyOn(fs, 'fsyncSync').mockImplementation(() => callOrder.push('fsync'));
    const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      callOrder.push('rename');
      realRenameSync(from, to);
    });

    FileService.writeVaultFile(filePath, sampleEnvelope());

    expect(callOrder).toEqual(['fsync', 'rename']);
    fsyncSpy.mockRestore();
    renameSpy.mockRestore();
  });
});

describe('readVaultFile', () => {
  test('throws for a missing file', () => {
    const dir = tempDir();
    expect(() => FileService.readVaultFile(path.join(dir, 'missing.xam'))).toThrow(/not found/i);
  });

  test('throws for invalid JSON', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'vault.xam');
    fs.writeFileSync(filePath, 'not valid json{{{');
    expect(() => FileService.readVaultFile(filePath)).toThrow(/corrupted/i);
  });

  test('throws when required fields are missing', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'vault.xam');
    fs.writeFileSync(filePath, JSON.stringify({ salt: 'x' })); // missing iv/authTag/ciphertext
    expect(() => FileService.readVaultFile(filePath)).toThrow(/missing required fields/i);
  });
});
