import fs from 'fs';
import os from 'os';
import path from 'path';
import { createVaultService } from './VaultService.js';
import { eventBus, VAULT_EVENT_CHANNEL } from './EventBus.js';

function createTestService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-vs-test-'));
  return createVaultService({
    vaultFilePath: path.join(dir, 'vault.xam'),
    backupDir: path.join(dir, 'backups'),
  });
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
