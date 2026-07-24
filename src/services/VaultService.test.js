import fs from 'fs';
import os from 'os';
import path from 'path';
import { createVaultService } from './VaultService.js';
import { eventBus, VAULT_EVENT_CHANNEL } from './EventBus.js';
import * as VaultRepository from '../repositories/VaultRepository.js';
import * as CryptoService from './CryptoService.js';

function createTestService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-vs-test-'));
  return createVaultService({
    vaultFilePath: path.join(dir, 'vault.xam'),
    backupDir: path.join(dir, 'backups'),
  });
}

// See QuickUnlockService.test.js for why safeStorage needs a fake under Jest.
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
      if (!store.has(id)) throw new Error('unknown ciphertext');
      return store.get(id);
    },
  };
}

function createTestServiceWithQuickUnlock(safeStorageOverrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-vs-test-'));
  const svc = createVaultService({
    vaultFilePath: path.join(dir, 'vault.xam'),
    backupDir: path.join(dir, 'backups'),
    quickUnlockFilePath: path.join(dir, 'quickunlock.dat'),
    safeStorage: createFakeSafeStorage(safeStorageOverrides),
  });
  return svc;
}

// EventBus is a shared, module-level singleton (by design - see
// src/services/EventBus.js). Each test that inspects emitted events must
// remove its own listener afterward or later tests would double-count.
function captureEvents() {
  const events = [];
  const listener = (event) => events.push(event);
  eventBus.on(VAULT_EVENT_CHANNEL, listener);
  return { events, stop: () => eventBus.off(VAULT_EVENT_CHANNEL, listener) };
}

describe('vault lifecycle', () => {
  test('create() fails on a password under 8 characters', () => {
    const svc = createTestService();
    expect(() => svc.create('short')).toThrow(/at least 8 characters/i);
  });

  test('create() then unlock() round-trips correctly', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    svc.lock();
    expect(svc.isUnlocked()).toBe(false);
    svc.unlock('supersecretpassword');
    expect(svc.isUnlocked()).toBe(true);
  });

  test('unlock() rejects the wrong password', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    svc.lock();
    expect(() => svc.unlock('wrong-password')).toThrow();
  });

  test('create() refuses to overwrite an existing vault', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    expect(() => svc.create('another-password')).toThrow(/already exists/i);
  });

  test('operations on a locked vault throw', () => {
    const svc = createTestService();
    expect(() => svc.getVault()).toThrow(/locked/i);
    expect(() => svc.addCategory('Personal')).toThrow(/locked/i);
  });

  test('changeMasterPassword requires the correct current password', () => {
    const svc = createTestService();
    svc.create('old-password-123');
    expect(() => svc.changeMasterPassword('wrong-current', 'new-password-123')).toThrow(/incorrect/i);

    svc.changeMasterPassword('old-password-123', 'new-password-123');
    svc.lock();
    expect(() => svc.unlock('old-password-123')).toThrow();
    svc.unlock('new-password-123');
    expect(svc.isUnlocked()).toBe(true);
  });
});

describe('PIN quick unlock', () => {
  test('is unavailable/disabled by default when no quickUnlockFilePath/safeStorage is configured', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    expect(svc.isQuickUnlockAvailable()).toBe(false);
    expect(svc.isQuickUnlockEnabled()).toBe(false);
    expect(() => svc.enableQuickUnlock('1234')).toThrow(/not configured/i);
  });

  test('enable then unlockWithPin unlocks the vault without the master password', () => {
    const svc = createTestServiceWithQuickUnlock();
    svc.create('supersecretpassword');
    svc.addCategory('Personal', 'category');
    svc.enableQuickUnlock('4242');
    svc.lock();

    expect(svc.isUnlocked()).toBe(false);
    expect(svc.unlockWithPin('4242')).toBe(true);
    expect(svc.isUnlocked()).toBe(true);
    expect(svc.getVault().categories).toHaveLength(1);
  });

  test('unlockWithPin rejects the wrong PIN and leaves the vault locked', () => {
    const svc = createTestServiceWithQuickUnlock();
    svc.create('supersecretpassword');
    svc.enableQuickUnlock('4242');
    svc.lock();

    expect(() => svc.unlockWithPin('0000')).toThrow(/incorrect pin/i);
    expect(svc.isUnlocked()).toBe(false);
  });

  test('disableQuickUnlock removes it and unlockWithPin then fails', () => {
    const svc = createTestServiceWithQuickUnlock();
    svc.create('supersecretpassword');
    svc.enableQuickUnlock('4242');
    svc.disableQuickUnlock();
    svc.lock();

    expect(svc.isQuickUnlockEnabled()).toBe(false);
    expect(() => svc.unlockWithPin('4242')).toThrow(/not set up/i);
  });

  test('changing the master password invalidates a previously enabled quick unlock', () => {
    const svc = createTestServiceWithQuickUnlock();
    svc.create('old-password-123');
    svc.enableQuickUnlock('4242');
    expect(svc.isQuickUnlockEnabled()).toBe(true);

    svc.changeMasterPassword('old-password-123', 'new-password-123');
    expect(svc.isQuickUnlockEnabled()).toBe(false);

    svc.lock();
    expect(() => svc.unlockWithPin('4242')).toThrow(/not set up/i);
  });

  test('restoring a backup invalidates a previously enabled quick unlock', () => {
    const svc = createTestServiceWithQuickUnlock();
    svc.create('supersecretpassword');
    svc.addCategory('Personal', 'category'); // triggers a backup
    svc.enableQuickUnlock('4242');
    const [backupPath] = svc.listBackups();

    svc.restoreBackup(backupPath);
    expect(svc.isQuickUnlockEnabled()).toBe(false);
  });
});

describe('key material hygiene', () => {
  test('lock() zeroes the in-memory session key Buffer rather than just dropping the reference', () => {
    const svc = createTestService();
    const deriveKeySpy = jest.spyOn(CryptoService, 'deriveKey');

    svc.create('supersecretpassword');
    const keyBuffer = deriveKeySpy.mock.results[0].value;
    expect(keyBuffer.some((byte) => byte !== 0)).toBe(true); // sanity: real derived key, not already blank

    svc.lock();
    expect(keyBuffer.every((byte) => byte === 0)).toBe(true);

    deriveKeySpy.mockRestore();
  });

  test('changeMasterPassword() zeroes the outgoing key Buffer, not just the new one', () => {
    const svc = createTestService();
    const deriveKeySpy = jest.spyOn(CryptoService, 'deriveKey');

    svc.create('old-password-123');
    const oldKeyBuffer = deriveKeySpy.mock.results[0].value;

    svc.changeMasterPassword('old-password-123', 'new-password-123');
    expect(oldKeyBuffer.every((byte) => byte === 0)).toBe(true);

    deriveKeySpy.mockRestore();
  });
});

describe('isVaultFileHealthy', () => {
  test('true when no vault file exists yet', () => {
    const svc = createTestService();
    expect(svc.isVaultFileHealthy()).toBe(true);
  });

  test('true for a freshly created, well-formed vault file', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    expect(svc.isVaultFileHealthy()).toBe(true);
  });

  test('false for a structurally corrupted vault file, without needing a password', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-vs-test-'));
    const vaultFilePath = path.join(dir, 'vault.xam');
    fs.writeFileSync(vaultFilePath, 'not valid json{{{');
    const svc = createVaultService({ vaultFilePath, backupDir: path.join(dir, 'backups') });

    expect(svc.isUnlocked()).toBe(false);
    expect(svc.isVaultFileHealthy()).toBe(false);
  });
});

describe('restoreBackup', () => {
  test('works while locked (the whole point, as a recovery path) and leaves the vault locked', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-vs-test-'));
    const vaultFilePath = path.join(dir, 'vault.xam');
    const backupDir = path.join(dir, 'backups');
    const svc = createVaultService({ vaultFilePath, backupDir });

    svc.create('supersecretpassword');
    svc.addCategory('Personal', 'category'); // triggers a backup of the pre-category state
    svc.lock();

    const [backupPath] = VaultRepository.listBackups(backupDir);
    expect(() => svc.restoreBackup(backupPath)).not.toThrow();
    expect(svc.isUnlocked()).toBe(false);

    svc.unlock('supersecretpassword');
    expect(svc.getVault().categories).toHaveLength(0); // restored the pre-category backup
  });

  test('recovers a structurally corrupted vault file by restoring a prior backup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-vs-test-'));
    const vaultFilePath = path.join(dir, 'vault.xam');
    const backupDir = path.join(dir, 'backups');
    const setupSvc = createVaultService({ vaultFilePath, backupDir });
    setupSvc.create('supersecretpassword');
    setupSvc.addCategory('Personal', 'category'); // backup #1: pre-category (0 categories)
    setupSvc.addCategory('Work', 'category'); // backup #2: pre-second-category (1 category: Personal)
    setupSvc.lock();
    // Most recent backup is the one holding 'Personal' just before 'Work' was added.
    const [backupPath] = VaultRepository.listBackups(backupDir);

    fs.writeFileSync(vaultFilePath, 'corrupted-not-json{{{');
    const recoverySvc = createVaultService({ vaultFilePath, backupDir });
    expect(recoverySvc.isVaultFileHealthy()).toBe(false);

    recoverySvc.restoreBackup(backupPath);
    expect(recoverySvc.isVaultFileHealthy()).toBe(true);
    recoverySvc.unlock('supersecretpassword');
    expect(recoverySvc.getVault().categories).toHaveLength(1);
    expect(recoverySvc.getVault().categories[0].name).toBe('Personal');
  });
});

describe('category / folder / entry CRUD', () => {
  test('addCategory / addFolder / addEntry build the expected tree shape', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');

    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    const entry = svc.addEntry(category.id, folder.id, { title: 'GitHub', template: 'Login' });

    const tree = svc.getVault().categories;
    expect(tree).toHaveLength(1);
    expect(tree[0].folders[0].entries[0].id).toBe(entry.id);
    expect(entry.fields.map((f) => f.label)).toEqual(['Username', 'Password', 'Website']);
  });

  test('nested subfolders are addressable and isolated from their parent', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const parent = svc.addFolder(category.id, null, 'Parent');
    const child = svc.addFolder(category.id, parent.id, 'Child');
    svc.addEntry(category.id, child.id, { title: 'Nested Entry', template: 'Custom' });

    const tree = svc.getVault().categories[0];
    const parentNode = tree.folders.find((f) => f.id === parent.id);
    expect(parentNode.entries).toHaveLength(0);
    expect(parentNode.folders[0].entries).toHaveLength(1);
  });

  test('updateEntryFields updates values and records password history', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    let entry = svc.addEntry(category.id, folder.id, { title: 'GitHub', template: 'Login' });

    const setPassword = (value) =>
      svc.updateEntryFields(entry.id, {
        fields: entry.fields.map((f) => (f.label === 'Password' ? { ...f, value } : f)),
      });

    entry = setPassword('first-password');
    entry = setPassword('second-password');
    const pwField = entry.fields.find((f) => f.label === 'Password');
    expect(pwField.value).toBe('second-password');
    expect(pwField.history[0].value).toBe('first-password');
  });

  test('password history respects the configured limit and disables at 0', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    let entry = svc.addEntry(category.id, folder.id, { title: 'Test', template: 'Login' });

    svc.updateVaultSettings({ passwordHistoryLimit: 1 });
    for (const pw of ['a', 'b', 'c']) {
      entry = svc.updateEntryFields(entry.id, {
        fields: entry.fields.map((f) => (f.label === 'Password' ? { ...f, value: pw } : f)),
      });
    }
    let pwField = entry.fields.find((f) => f.label === 'Password');
    expect(pwField.history).toHaveLength(1);

    svc.updateVaultSettings({ passwordHistoryLimit: 0 });
    entry = svc.updateEntryFields(entry.id, {
      fields: entry.fields.map((f) => (f.label === 'Password' ? { ...f, value: 'd' } : f)),
    });
    pwField = entry.fields.find((f) => f.label === 'Password');
    expect(pwField.history).toHaveLength(0);
  });

  test('non-secret fields never accrue history', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    let entry = svc.addEntry(category.id, folder.id, { title: 'Test', template: 'Login' });

    entry = svc.updateEntryFields(entry.id, {
      fields: entry.fields.map((f) => (f.label === 'Username' ? { ...f, value: 'alice' } : f)),
    });
    const userField = entry.fields.find((f) => f.label === 'Username');
    expect(userField.history).toBeUndefined();
  });

  test('moveFolder relocates a folder (and its contents) to a new parent', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folderA = svc.addFolder(category.id, null, 'A');
    const folderB = svc.addFolder(category.id, null, 'B');
    svc.addEntry(category.id, folderA.id, { title: 'Entry', template: 'Custom' });

    svc.moveFolder(folderA.id, category.id, folderB.id);

    const tree = svc.getVault().categories[0];
    expect(tree.folders).toHaveLength(1); // only B remains at root
    expect(tree.folders[0].id).toBe(folderB.id);
    expect(tree.folders[0].folders[0].id).toBe(folderA.id);
    expect(tree.folders[0].folders[0].entries).toHaveLength(1);
  });

  test('moveFolder with beforeFolderId reorders siblings instead of appending at the end', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const a = svc.addFolder(category.id, null, 'A');
    const b = svc.addFolder(category.id, null, 'B');
    const c = svc.addFolder(category.id, null, 'C');
    expect(svc.getVault().categories[0].folders.map((f) => f.name)).toEqual(['A', 'B', 'C']);

    // Move C before B: A, C, B
    svc.moveFolder(c.id, category.id, null, b.id);
    expect(svc.getVault().categories[0].folders.map((f) => f.id)).toEqual([a.id, c.id, b.id]);
  });

  test('moveFolder falls back to appending when beforeFolderId is omitted or not found', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const a = svc.addFolder(category.id, null, 'A');
    const b = svc.addFolder(category.id, null, 'B');

    svc.moveFolder(a.id, category.id, null);
    expect(svc.getVault().categories[0].folders.map((f) => f.id)).toEqual([b.id, a.id]);
  });

  test('duplicateEntryById creates an independent copy with fresh field ids', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    const entry = svc.addEntry(category.id, folder.id, { title: 'Original', template: 'Login' });

    const copy = svc.duplicateEntryById(entry.id);
    expect(copy.id).not.toBe(entry.id);
    expect(copy.title).toBe('Original (Copy)');
    expect(copy.fields.map((f) => f.id)).not.toEqual(entry.fields.map((f) => f.id));
  });

  test('toggleFavorite flips the favorite flag', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    const entry = svc.addEntry(category.id, folder.id, { title: 'Test', template: 'Custom' });
    expect(entry.favorite).toBe(false);

    const toggled = svc.toggleFavorite(entry.id);
    expect(toggled.favorite).toBe(true);
    expect(svc.listFavorites()).toHaveLength(1);
  });
});

describe('listRecentEntries', () => {
  test('returns entries newest-updated-first, capped at the given limit', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    const a = svc.addEntry(category.id, folder.id, { title: 'A', template: 'Custom' });
    svc.addEntry(category.id, folder.id, { title: 'B', template: 'Custom' });
    const c = svc.addEntry(category.id, folder.id, { title: 'C', template: 'Custom' });

    // Touch A again so it becomes the most recently updated, even though
    // it was created first.
    svc.updateEntryFields(a.id, { title: 'A' });

    const recent = svc.listRecentEntries(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe(a.id);
    expect(recent[1].id).toBe(c.id);
  });
});

describe('findReusedPasswords', () => {
  test('groups entries that share the same password field value', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    let entryA = svc.addEntry(category.id, folder.id, { title: 'Site A', template: 'Login' });
    let entryB = svc.addEntry(category.id, folder.id, { title: 'Site B', template: 'Login' });
    svc.addEntry(category.id, folder.id, { title: 'Site C', template: 'Login' }); // stays unique, no password set

    const setPassword = (entry, value) =>
      svc.updateEntryFields(entry.id, {
        fields: entry.fields.map((f) => (f.type === 'password' ? { ...f, value } : f)),
      });
    entryA = setPassword(entryA, 'shared-secret');
    entryB = setPassword(entryB, 'shared-secret');

    const groups = svc.findReusedPasswords();
    expect(groups).toHaveLength(1);
    expect(groups[0].map((e) => e.id).sort()).toEqual([entryA.id, entryB.id].sort());
  });

  test('returns no groups when no password is reused', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    svc.addEntry(category.id, folder.id, { title: 'Site A', template: 'Login' });
    svc.addEntry(category.id, folder.id, { title: 'Site B', template: 'Login' });

    expect(svc.findReusedPasswords()).toEqual([]);
  });
});

describe('backup management', () => {
  test('deleteBackup removes it from listBackups', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    svc.addCategory('Personal', 'category'); // triggers a backup
    const [backupPath] = svc.listBackups();

    svc.deleteBackup(backupPath);
    expect(svc.listBackups()).not.toContain(backupPath);
  });

  test('renameBackup enforces the vault- prefix so listBackups still finds it', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    svc.addCategory('Personal', 'category');
    const [backupPath] = svc.listBackups();

    const newPath = svc.renameBackup(backupPath, 'before cleanup');
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.existsSync(backupPath)).toBe(false);
    expect(svc.listBackups()).toContain(newPath);
  });

  test('renameBackup rejects an empty label', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    svc.addCategory('Personal', 'category');
    const [backupPath] = svc.listBackups();

    expect(() => svc.renameBackup(backupPath, '   ')).toThrow(/empty/i);
  });

  test('exportBackupTo copies the backup file to the destination', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    svc.addCategory('Personal', 'category');
    const [backupPath] = svc.listBackups();

    const destPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xela-export-')), 'exported.bak');
    svc.exportBackupTo(backupPath, destPath);
    expect(fs.readFileSync(destPath, 'utf8')).toBe(fs.readFileSync(backupPath, 'utf8'));
  });
});

describe('recycle bin', () => {
  test('deleting an entry/folder/category moves it to the recycle bin, and restore brings it back', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    const entry = svc.addEntry(category.id, folder.id, { title: 'Test', template: 'Custom' });

    svc.deleteEntry(entry.id);
    expect(svc.getVault().categories[0].folders[0].entries).toHaveLength(0);
    let bin = svc.getVault().recycleBin;
    expect(bin).toHaveLength(1);
    expect(bin[0].type).toBe('entry');

    svc.restoreFromRecycleBin(bin[0].id);
    expect(svc.getVault().categories[0].folders[0].entries).toHaveLength(1);
    expect(svc.getVault().recycleBin).toHaveLength(0);
  });

  test('permanentlyDelete removes the record without restoring it', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    svc.deleteCategory(category.id);
    const [record] = svc.getVault().recycleBin;

    svc.permanentlyDelete(record.id);
    expect(svc.getVault().recycleBin).toHaveLength(0);
    expect(svc.getVault().categories).toHaveLength(0);
  });

  test('emptyRecycleBin clears everything at once', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    svc.addCategory('A', 'category');
    const b = svc.addCategory('B', 'category');
    svc.deleteCategory(b.id);
    expect(svc.getVault().recycleBin.length).toBeGreaterThan(0);

    svc.emptyRecycleBin();
    expect(svc.getVault().recycleBin).toHaveLength(0);
  });
});

describe('settings validation', () => {
  test('rejects an invalid theme, negative autoLockMinutes, and out-of-range backupCount', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');

    expect(() => svc.updateVaultSettings({ theme: 'neon' })).toThrow();
    expect(() => svc.updateVaultSettings({ autoLockMinutes: -1 })).toThrow();
    expect(() => svc.updateVaultSettings({ backupCount: 0 })).toThrow();
    expect(() => svc.updateVaultSettings({ backupCount: 101 })).toThrow();
  });

  test('rejects a password generator with every character set disabled', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    expect(() =>
      svc.updateVaultSettings({
        passwordGenerator: { uppercase: false, lowercase: false, numbers: false, symbols: false },
      }),
    ).toThrow(/at least one/i);
  });

  test('accepts a valid settings update and leaves other fields untouched', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const before = svc.getSettings();
    const after = svc.updateVaultSettings({ theme: 'dark' });
    expect(after.theme).toBe('dark');
    expect(after.autoLockMinutes).toBe(before.autoLockMinutes);
  });

  test('accentColor defaults to null and accepts a valid 6-digit hex color', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    expect(svc.getSettings().accentColor).toBeNull();

    const after = svc.updateVaultSettings({ accentColor: '#ff8800' });
    expect(after.accentColor).toBe('#ff8800');

    const reset = svc.updateVaultSettings({ accentColor: null });
    expect(reset.accentColor).toBeNull();
  });

  test('rejects a malformed accentColor', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    expect(() => svc.updateVaultSettings({ accentColor: 'blue' })).toThrow(/hex color/i);
    expect(() => svc.updateVaultSettings({ accentColor: '#fff' })).toThrow(/hex color/i);
  });

  test('backgroundImage defaults to null, accepts a data URI, and rejects non-image values', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    expect(svc.getSettings().backgroundImage).toBeNull();

    const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const after = svc.updateVaultSettings({ backgroundImage: dataUri });
    expect(after.backgroundImage).toBe(dataUri);

    expect(() => svc.updateVaultSettings({ backgroundImage: 'not-a-data-uri' })).toThrow(/data uri/i);
    expect(() =>
      svc.updateVaultSettings({ backgroundImage: `data:image/jpeg;base64,${'a'.repeat(5 * 1024 * 1024)}` }),
    ).toThrow(/too large/i);
  });
});

describe('search', () => {
  test('finds entries by title but never matches hidden field values', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const category = svc.addCategory('Personal', 'category');
    const folder = svc.addFolder(category.id, null, 'General');
    const entry = svc.addEntry(category.id, folder.id, { title: 'GitHub Login', template: 'Login' });
    svc.updateEntryFields(entry.id, {
      fields: entry.fields.map((f) => (f.label === 'Password' ? { ...f, value: 'unique-secret-xyz' } : f)),
    });

    const byTitle = svc.search('github');
    expect(byTitle.some((r) => r.type === 'entry')).toBe(true);

    const byHiddenValue = svc.search('unique-secret-xyz');
    expect(byHiddenValue.filter((r) => r.type === 'entry')).toHaveLength(0);
  });
});

describe('restoreSnapshot (undo/redo primitive)', () => {
  test('replaces the in-memory vault wholesale and persists it', () => {
    const svc = createTestService();
    svc.create('supersecretpassword');
    const before = svc.getVault();
    svc.addCategory('Personal', 'category');
    expect(svc.getVault().categories).toHaveLength(1);

    svc.restoreSnapshot(before);
    expect(svc.getVault().categories).toHaveLength(0);

    svc.lock();
    svc.unlock('supersecretpassword');
    expect(svc.getVault().categories).toHaveLength(0); // persisted, not just in-memory
  });
});

describe('EventBus integration', () => {
  test('mutations emit the expected action names in order', () => {
    const capture = captureEvents();
    try {
      const svc = createTestService();
      svc.create('supersecretpassword');
      const category = svc.addCategory('Personal', 'category');
      svc.lock();

      expect(capture.events.map((e) => e.action)).toEqual(['vault.created', 'category.created', 'vault.locked']);
      expect(capture.events[1].details).toMatchObject({ categoryId: category.id, name: 'Personal' });
      expect(capture.events.every((e) => typeof e.timestamp === 'string')).toBe(true);
    } finally {
      capture.stop();
    }
  });
});
