import fs from 'fs';
import os from 'os';
import path from 'path';
import * as VaultRepository from './VaultRepository.js';

function tempPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-repo-test-'));
  return {
    dir,
    vaultFilePath: path.join(dir, 'vault.xam'),
    backupDir: path.join(dir, 'backups'),
  };
}

const sampleVault = (overrides = {}) => ({
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  settings: { backupCount: 10 },
  categories: [],
  activityLog: [],
  recycleBin: [],
  ...overrides,
});

describe('exists', () => {
  test('reflects whether the vault file has been created yet', () => {
    const { vaultFilePath, backupDir } = tempPaths();
    expect(VaultRepository.exists(vaultFilePath)).toBe(false);
    VaultRepository.create(vaultFilePath, backupDir, 'password123', sampleVault());
    expect(VaultRepository.exists(vaultFilePath)).toBe(true);
  });
});

describe('create / load', () => {
  test('round-trips a vault through create + load with the correct password', () => {
    const { vaultFilePath, backupDir } = tempPaths();
    const vault = sampleVault({ categories: [{ id: 'cat1', name: 'Personal' }] });
    VaultRepository.create(vaultFilePath, backupDir, 'my-password', vault);

    const { vault: loaded } = VaultRepository.load(vaultFilePath, 'my-password');
    expect(loaded).toEqual(vault);
  });

  test('rejects the wrong password on load', () => {
    const { vaultFilePath, backupDir } = tempPaths();
    VaultRepository.create(vaultFilePath, backupDir, 'right-password', sampleVault());
    expect(() => VaultRepository.load(vaultFilePath, 'wrong-password')).toThrow();
  });

  test('load throws for a missing file', () => {
    const { vaultFilePath } = tempPaths();
    expect(() => VaultRepository.load(vaultFilePath, 'password')).toThrow(/not found/i);
  });

  test('the on-disk file never contains plaintext vault content', () => {
    const { vaultFilePath, backupDir } = tempPaths();
    VaultRepository.create(vaultFilePath, backupDir, 'password123', sampleVault({ categories: [{ id: 'secret-marker' }] }));
    const raw = fs.readFileSync(vaultFilePath, 'utf8');
    expect(raw).not.toContain('secret-marker');
  });
});

describe('save', () => {
  test('persists updated vault content and creates a backup of the prior file', () => {
    const { vaultFilePath, backupDir } = tempPaths();
    const { sessionKey, salt } = VaultRepository.create(vaultFilePath, backupDir, 'password123', sampleVault());

    const updated = sampleVault({ categories: [{ id: 'cat1', name: 'Work' }] });
    VaultRepository.save(vaultFilePath, backupDir, updated, sessionKey, salt);

    const { vault: reloaded } = VaultRepository.load(vaultFilePath, 'password123');
    expect(reloaded).toEqual(updated);
    expect(fs.existsSync(backupDir)).toBe(true);
    expect(fs.readdirSync(backupDir).length).toBeGreaterThan(0);
  });
});

describe('deriveNewKey / verifyKey', () => {
  test('verifyKey confirms a matching password and rejects a mismatched one', () => {
    const { sessionKey, salt } = VaultRepository.deriveNewKey('the-password');
    expect(VaultRepository.verifyKey('the-password', salt, sessionKey)).toBe(true);
    expect(VaultRepository.verifyKey('not-the-password', salt, sessionKey)).toBe(false);
  });
});

describe('exportTo / importFrom / replaceLiveFile', () => {
  test('exportTo copies the live file byte-for-byte', () => {
    const { vaultFilePath, backupDir, dir } = tempPaths();
    VaultRepository.create(vaultFilePath, backupDir, 'password123', sampleVault());
    const destPath = path.join(dir, 'exported.xam');
    VaultRepository.exportTo(vaultFilePath, destPath);
    expect(fs.readFileSync(destPath, 'utf8')).toBe(fs.readFileSync(vaultFilePath, 'utf8'));
  });

  test('importFrom decrypts an external file without touching the live vault path', () => {
    const source = tempPaths();
    const vault = sampleVault({ categories: [{ id: 'imported-cat' }] });
    VaultRepository.create(source.vaultFilePath, source.backupDir, 'import-password', vault);

    const live = tempPaths();
    expect(VaultRepository.exists(live.vaultFilePath)).toBe(false);
    const { vault: imported } = VaultRepository.importFrom(source.vaultFilePath, 'import-password');
    expect(imported).toEqual(vault);
    // importFrom must not itself write to any "live" location.
    expect(VaultRepository.exists(live.vaultFilePath)).toBe(false);
  });

  test('importFrom throws on the wrong password without side effects', () => {
    const source = tempPaths();
    VaultRepository.create(source.vaultFilePath, source.backupDir, 'right-password', sampleVault());
    expect(() => VaultRepository.importFrom(source.vaultFilePath, 'wrong-password')).toThrow();
  });

  test('replaceLiveFile backs up the current live file before overwriting it', () => {
    const live = tempPaths();
    VaultRepository.create(live.vaultFilePath, live.backupDir, 'old-password', sampleVault({ categories: [{ id: 'old' }] }));

    const source = tempPaths();
    VaultRepository.create(source.vaultFilePath, source.backupDir, 'new-password', sampleVault({ categories: [{ id: 'new' }] }));

    VaultRepository.replaceLiveFile(source.vaultFilePath, live.vaultFilePath, live.backupDir, 10);

    // The live file now holds the imported content...
    const { vault: liveNow } = VaultRepository.load(live.vaultFilePath, 'new-password');
    expect(liveNow.categories[0].id).toBe('new');
    // ...and the old content is recoverable from the backup that was made.
    expect(fs.readdirSync(live.backupDir).length).toBeGreaterThan(0);
  });

  test('replaceLiveFile skips backup when there was no prior live file', () => {
    const live = tempPaths();
    const source = tempPaths();
    VaultRepository.create(source.vaultFilePath, source.backupDir, 'password', sampleVault());

    expect(() => VaultRepository.replaceLiveFile(source.vaultFilePath, live.vaultFilePath, live.backupDir, 10)).not.toThrow();
    expect(VaultRepository.exists(live.vaultFilePath)).toBe(true);
  });
});

describe('listBackups', () => {
  test('reflects backups created by save()', () => {
    const { vaultFilePath, backupDir } = tempPaths();
    const { sessionKey, salt } = VaultRepository.create(vaultFilePath, backupDir, 'password123', sampleVault());
    expect(VaultRepository.listBackups(backupDir)).toEqual([]);

    VaultRepository.save(vaultFilePath, backupDir, sampleVault({ categories: [{ id: 'x' }] }), sessionKey, salt);
    expect(VaultRepository.listBackups(backupDir).length).toBe(1);
  });
});
