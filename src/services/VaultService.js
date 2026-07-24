import * as VaultRepository from '../repositories/VaultRepository.js';
import * as SearchService from './SearchService.js';
import * as ActivityLogService from './ActivityLogService.js';
import * as RecycleBinService from './RecycleBinService.js';
import * as SettingsService from './SettingsService.js';
import { emitVaultEvent } from './EventBus.js';

import { createVault, touchVault, isVaultValid } from '../models/Vault.js';
import { createCategory } from '../models/Category.js';
import { createFolder, findFolderById, findParentFolder } from '../models/Folder.js';
import { createEntry, updateEntry as applyEntryUpdate, duplicateEntry } from '../models/Entry.js';
import { updateField } from '../models/Field.js';
import { nextHistory } from '../models/PasswordHistory.js';

const logActivity = ActivityLogService.record;

/**
 * VaultService holds all runtime state for a single unlocked vault session
 * (the derived key and the decrypted vault object live only in memory,
 * never on disk in plaintext). It is instantiated once per app run in the
 * Electron main process.
 */
export function createVaultService({ vaultFilePath, backupDir }) {
  let sessionKey = null; // Buffer - derived AES key, present only while unlocked
  let salt = null; // Buffer - PBKDF2 salt read from / written to the vault file
  let vault = null; // decrypted Vault object, present only while unlocked

  // ---- session -------------------------------------------------------

  function vaultFileExists() {
    return VaultRepository.exists(vaultFilePath);
  }

  /**
   * Reports whether the vault file (if any) is at least well-formed,
   * without needing a password. Callable while locked - it's meant to be
   * checked at launch, before the user has entered anything, so a
   * genuinely corrupted file can be flagged immediately instead of only
   * surfacing as a mysterious "incorrect password" on every attempt.
   */
  function isVaultFileHealthy() {
    if (!vaultFileExists()) return true; // nothing to be unhealthy yet
    return VaultRepository.isStructurallyValid(vaultFilePath);
  }

  function isUnlocked() {
    return sessionKey !== null && vault !== null;
  }

  function requireUnlocked() {
    if (!isUnlocked()) {
      throw new Error('Vault is locked');
    }
  }

  // Node Buffers aren't zeroed on assignment - dropping the last reference
  // just makes the key material eligible for GC, but until that runs the
  // raw key bytes sit in the heap (and are a candidate for paging to disk)
  // for an indeterminate amount of time. Overwriting in place bounds that
  // window to "immediately".
  function wipeKeyMaterial() {
    if (sessionKey) sessionKey.fill(0);
    if (salt) salt.fill(0);
  }

  function lock() {
    wipeKeyMaterial();
    sessionKey = null;
    salt = null;
    vault = null;
    emitVaultEvent('vault.locked');
  }

  /**
   * Persists the in-memory vault to disk via the repository (which handles
   * backup rotation + encryption + the atomic write).
   */
  function persist() {
    requireUnlocked();
    VaultRepository.save(vaultFilePath, backupDir, vault, sessionKey, salt);
  }

  /**
   * Creates a brand-new vault protected by masterPassword. Fails if a
   * vault already exists at vaultFilePath.
   */
  function create(masterPassword) {
    if (vaultFileExists()) {
      throw new Error('A vault already exists');
    }
    if (!masterPassword || masterPassword.length < 8) {
      throw new Error('Master password must be at least 8 characters');
    }

    const initialVault = logActivity(createVault(), 'vault.created');
    const { sessionKey: newKey, salt: newSalt } = VaultRepository.create(
      vaultFilePath,
      backupDir,
      masterPassword,
      initialVault,
    );
    salt = newSalt;
    sessionKey = newKey;
    vault = initialVault;
    emitVaultEvent('vault.created');
    return true;
  }

  /**
   * Attempts to unlock the vault with the given password. Returns true on
   * success; throws on wrong password / missing / corrupted vault.
   */
  function unlock(masterPassword) {
    const { vault: decrypted, sessionKey: newKey, salt: newSalt } = VaultRepository.load(
      vaultFilePath,
      masterPassword,
    );
    if (!isVaultValid(decrypted)) {
      throw new Error('Vault file is corrupted');
    }

    salt = newSalt;
    sessionKey = newKey;
    vault = decrypted;
    emitVaultEvent('vault.unlocked');
    return true;
  }

  function getVault() {
    requireUnlocked();
    return vault;
  }

  /**
   * Replaces the in-memory vault wholesale with a previously-captured
   * snapshot (from `getVault()`) and persists it. Used by undo/redo -
   * intentionally does not `touchVault()` the snapshot, so restoring is
   * byte-identical to the state that was actually captured.
   */
  function restoreSnapshot(snapshot) {
    requireUnlocked();
    vault = snapshot;
    persist();
  }

  function changeMasterPassword(currentPassword, newPassword) {
    requireUnlocked();
    if (!VaultRepository.verifyKey(currentPassword, salt, sessionKey)) {
      throw new Error('Current password is incorrect');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New master password must be at least 8 characters');
    }
    const { sessionKey: newKey, salt: newSalt } = VaultRepository.deriveNewKey(newPassword);
    wipeKeyMaterial();
    salt = newSalt;
    sessionKey = newKey;
    vault = logActivity(touchVault(vault), 'vault.masterPasswordChanged');
    persist();
    emitVaultEvent('vault.masterPasswordChanged');
    return true;
  }

  // ---- tree location helpers -----------------------------------------

  function locateFolder(folderId) {
    for (const category of vault.categories) {
      for (const rootFolder of category.folders) {
        const found = findFolderById(rootFolder, folderId);
        if (found) {
          const parent = findParentFolder(rootFolder, folderId);
          return { category, folder: found, parentFolder: parent, rootFolder };
        }
      }
    }
    return null;
  }

  function locateEntry(entryId) {
    for (const category of vault.categories) {
      for (const rootFolder of category.folders) {
        let result = null;
        const search = (folder) => {
          const idx = folder.entries.findIndex((e) => e.id === entryId);
          if (idx !== -1) {
            result = { category, folder, entry: folder.entries[idx], index: idx };
            return true;
          }
          return folder.folders.some(search);
        };
        if (search(rootFolder)) return result;
      }
    }
    return null;
  }

  function replaceFolderInTree(rootFolder, folderId, updater) {
    if (rootFolder.id === folderId) return updater(rootFolder);
    return {
      ...rootFolder,
      folders: rootFolder.folders.map((f) => replaceFolderInTree(f, folderId, updater)),
    };
  }

  function mutateFolder(categoryId, folderId, updater) {
    vault = {
      ...vault,
      categories: vault.categories.map((cat) => {
        if (cat.id !== categoryId) return cat;
        return {
          ...cat,
          folders: cat.folders.map((rootFolder) => replaceFolderInTree(rootFolder, folderId, updater)),
        };
      }),
    };
  }

  // ---- categories ------------------------------------------------------

  function addCategory(name, icon) {
    requireUnlocked();
    const category = createCategory({ name, icon });
    vault = logActivity(touchVault({ ...vault, categories: [...vault.categories, category] }), 'category.created', {
      categoryId: category.id,
      name,
    });
    persist();
    emitVaultEvent('category.created', { categoryId: category.id, name });
    return category;
  }

  function renameCategory(categoryId, name) {
    requireUnlocked();
    vault = logActivity(
      touchVault({
        ...vault,
        categories: vault.categories.map((c) => (c.id === categoryId ? { ...c, name } : c)),
      }),
      'category.renamed',
      { categoryId, name },
    );
    persist();
    emitVaultEvent('category.renamed', { categoryId, name });
  }

  function deleteCategory(categoryId) {
    requireUnlocked();
    const category = vault.categories.find((c) => c.id === categoryId);
    if (!category) throw new Error('Category not found');

    const recycled = RecycleBinService.buildRecord({ type: 'category', item: category });
    vault = logActivity(
      RecycleBinService.addRecord(
        touchVault({
          ...vault,
          categories: vault.categories.filter((c) => c.id !== categoryId),
        }),
        recycled,
      ),
      'category.deleted',
      { categoryId, name: category.name },
    );
    persist();
    emitVaultEvent('category.deleted', { categoryId, name: category.name });
  }

  // ---- folders -----------------------------------------------------------

  function addFolder(categoryId, parentFolderId, name) {
    requireUnlocked();
    const category = vault.categories.find((c) => c.id === categoryId);
    if (!category) throw new Error('Category not found');
    const newFolder = createFolder({ name });

    if (!parentFolderId) {
      vault = {
        ...vault,
        categories: vault.categories.map((c) =>
          c.id === categoryId ? { ...c, folders: [...c.folders, newFolder] } : c,
        ),
      };
    } else {
      mutateFolder(categoryId, parentFolderId, (f) => ({ ...f, folders: [...f.folders, newFolder] }));
    }

    vault = logActivity(touchVault(vault), 'folder.created', { folderId: newFolder.id, name });
    persist();
    emitVaultEvent('folder.created', { folderId: newFolder.id, name });
    return newFolder;
  }

  function renameFolder(categoryId, folderId, name) {
    requireUnlocked();
    mutateFolder(categoryId, folderId, (f) => ({ ...f, name, updatedAt: new Date().toISOString() }));
    vault = logActivity(touchVault(vault), 'folder.renamed', { folderId, name });
    persist();
    emitVaultEvent('folder.renamed', { folderId, name });
  }

  function deleteFolder(categoryId, folderId) {
    requireUnlocked();
    const located = locateFolder(folderId);
    if (!located) throw new Error('Folder not found');

    const recycled = RecycleBinService.buildRecord({ type: 'folder', item: located.folder, categoryId });

    if (located.parentFolder) {
      mutateFolder(categoryId, located.parentFolder.id, (f) => ({
        ...f,
        folders: f.folders.filter((child) => child.id !== folderId),
      }));
    } else {
      vault = {
        ...vault,
        categories: vault.categories.map((c) =>
          c.id === categoryId ? { ...c, folders: c.folders.filter((f) => f.id !== folderId) } : c,
        ),
      };
    }

    vault = logActivity(RecycleBinService.addRecord(touchVault(vault), recycled), 'folder.deleted', {
      folderId,
      name: located.folder.name,
    });
    persist();
    emitVaultEvent('folder.deleted', { folderId, name: located.folder.name });
  }

  function moveFolder(folderId, targetCategoryId, targetParentFolderId) {
    requireUnlocked();
    const located = locateFolder(folderId);
    if (!located) throw new Error('Folder not found');
    const targetCategory = vault.categories.find((c) => c.id === targetCategoryId);
    if (!targetCategory) throw new Error('Target category not found');

    // remove from current location
    deleteFolderNoRecycle(located.category.id, folderId);
    // re-insert at target
    if (!targetParentFolderId) {
      vault = {
        ...vault,
        categories: vault.categories.map((c) =>
          c.id === targetCategoryId ? { ...c, folders: [...c.folders, located.folder] } : c,
        ),
      };
    } else {
      mutateFolder(targetCategoryId, targetParentFolderId, (f) => ({
        ...f,
        folders: [...f.folders, located.folder],
      }));
    }

    vault = logActivity(touchVault(vault), 'folder.moved', { folderId, targetCategoryId, targetParentFolderId });
    persist();
    emitVaultEvent('folder.moved', { folderId, targetCategoryId, targetParentFolderId });
  }

  // internal: remove a folder from the tree without recycle-bin bookkeeping
  function deleteFolderNoRecycle(categoryId, folderId) {
    const located = locateFolder(folderId);
    if (!located) return;
    if (located.parentFolder) {
      mutateFolder(categoryId, located.parentFolder.id, (f) => ({
        ...f,
        folders: f.folders.filter((child) => child.id !== folderId),
      }));
    } else {
      vault = {
        ...vault,
        categories: vault.categories.map((c) =>
          c.id === categoryId ? { ...c, folders: c.folders.filter((f) => f.id !== folderId) } : c,
        ),
      };
    }
  }

  // ---- entries -----------------------------------------------------------

  function addEntry(categoryId, folderId, entryData) {
    requireUnlocked();
    const entry = createEntry(entryData);
    mutateFolder(categoryId, folderId, (f) => ({ ...f, entries: [...f.entries, entry] }));
    vault = logActivity(touchVault(vault), 'entry.created', { entryId: entry.id, title: entry.title });
    persist();
    emitVaultEvent('entry.created', { entryId: entry.id, title: entry.title });
    return entry;
  }

  function updateEntryFields(entryId, updates) {
    requireUnlocked();
    const located = locateEntry(entryId);
    if (!located) throw new Error('Entry not found');

    let nextFields = located.entry.fields;
    if (updates.fields) {
      nextFields = updates.fields.map((incoming) => {
        const existing = located.entry.fields.find((f) => f.id === incoming.id);
        if (!existing) return incoming; // brand-new field appended by the UI
        if (existing.value === incoming.value) return { ...existing, ...incoming };

        const history = nextHistory(existing, vault.settings.passwordHistoryLimit);
        return updateField(existing, { ...incoming, history });
      });
    }

    const updatedEntry = applyEntryUpdate(located.entry, { ...updates, fields: nextFields });
    mutateFolder(located.category.id, located.folder.id, (f) => ({
      ...f,
      entries: f.entries.map((e) => (e.id === entryId ? updatedEntry : e)),
    }));
    vault = logActivity(touchVault(vault), 'entry.updated', { entryId, title: updatedEntry.title });
    persist();
    emitVaultEvent('entry.updated', { entryId, title: updatedEntry.title });
    return updatedEntry;
  }

  function deleteEntry(entryId) {
    requireUnlocked();
    const located = locateEntry(entryId);
    if (!located) throw new Error('Entry not found');

    const recycled = RecycleBinService.buildRecord({
      type: 'entry',
      item: located.entry,
      categoryId: located.category.id,
      folderId: located.folder.id,
    });

    mutateFolder(located.category.id, located.folder.id, (f) => ({
      ...f,
      entries: f.entries.filter((e) => e.id !== entryId),
    }));
    vault = logActivity(RecycleBinService.addRecord(touchVault(vault), recycled), 'entry.deleted', {
      entryId,
      title: located.entry.title,
    });
    persist();
    emitVaultEvent('entry.deleted', { entryId, title: located.entry.title });
  }

  function moveEntry(entryId, targetCategoryId, targetFolderId) {
    requireUnlocked();
    const located = locateEntry(entryId);
    if (!located) throw new Error('Entry not found');

    mutateFolder(located.category.id, located.folder.id, (f) => ({
      ...f,
      entries: f.entries.filter((e) => e.id !== entryId),
    }));
    mutateFolder(targetCategoryId, targetFolderId, (f) => ({ ...f, entries: [...f.entries, located.entry] }));

    vault = logActivity(touchVault(vault), 'entry.moved', { entryId, targetCategoryId, targetFolderId });
    persist();
    emitVaultEvent('entry.moved', { entryId, targetCategoryId, targetFolderId });
  }

  function duplicateEntryById(entryId) {
    requireUnlocked();
    const located = locateEntry(entryId);
    if (!located) throw new Error('Entry not found');
    const copy = duplicateEntry(located.entry);
    mutateFolder(located.category.id, located.folder.id, (f) => ({ ...f, entries: [...f.entries, copy] }));
    vault = logActivity(touchVault(vault), 'entry.duplicated', { entryId, copyId: copy.id });
    persist();
    emitVaultEvent('entry.duplicated', { entryId, copyId: copy.id });
    return copy;
  }

  function toggleFavorite(entryId) {
    requireUnlocked();
    const located = locateEntry(entryId);
    if (!located) throw new Error('Entry not found');
    const updated = applyEntryUpdate(located.entry, { favorite: !located.entry.favorite });
    mutateFolder(located.category.id, located.folder.id, (f) => ({
      ...f,
      entries: f.entries.map((e) => (e.id === entryId ? updated : e)),
    }));
    vault = touchVault(vault);
    persist();
    emitVaultEvent('entry.favoriteToggled', { entryId, favorite: updated.favorite });
    return updated;
  }

  function listFavorites() {
    requireUnlocked();
    const favorites = [];
    for (const category of vault.categories) {
      const walk = (folder) => {
        favorites.push(...folder.entries.filter((e) => e.favorite));
        folder.folders.forEach(walk);
      };
      category.folders.forEach(walk);
    }
    return favorites;
  }

  function listRecentActivity(limit = 20) {
    requireUnlocked();
    return ActivityLogService.list(vault, limit);
  }

  /**
   * Records a renderer-side error (from ErrorBoundary) into the activity
   * log. A no-op while locked - there is no vault to write the entry
   * into, and errors on the Login/unlock screen aren't worth losing the
   * user's place over.
   */
  function recordError(message, stack) {
    if (!isUnlocked()) return;
    vault = logActivity(touchVault(vault), 'app.error', { message, stack });
    persist();
    emitVaultEvent('app.error', { message, stack });
  }

  // ---- recycle bin ---------------------------------------------------

  function restoreFromRecycleBin(recycleId) {
    requireUnlocked();
    const record = RecycleBinService.findRecord(vault, recycleId);
    if (!record) throw new Error('Recycle bin item not found');

    if (record.type === 'category') {
      vault = { ...vault, categories: [...vault.categories, record.item] };
    } else if (record.type === 'folder') {
      const category = vault.categories.find((c) => c.id === record.categoryId);
      if (!category) throw new Error('Original category no longer exists');
      vault = {
        ...vault,
        categories: vault.categories.map((c) =>
          c.id === record.categoryId ? { ...c, folders: [...c.folders, record.item] } : c,
        ),
      };
    } else if (record.type === 'entry') {
      const located = locateFolder(record.folderId);
      if (!located) throw new Error('Original folder no longer exists');
      mutateFolder(record.categoryId, record.folderId, (f) => ({ ...f, entries: [...f.entries, record.item] }));
    }

    vault = logActivity(
      touchVault(RecycleBinService.removeRecord(vault, recycleId)),
      'recycleBin.restored',
      { recycleId, type: record.type },
    );
    persist();
    emitVaultEvent('recycleBin.restored', { recycleId, type: record.type });
  }

  function permanentlyDelete(recycleId) {
    requireUnlocked();
    vault = logActivity(
      touchVault(RecycleBinService.removeRecord(vault, recycleId)),
      'recycleBin.permanentlyDeleted',
      { recycleId },
    );
    persist();
    emitVaultEvent('recycleBin.permanentlyDeleted', { recycleId });
  }

  function emptyRecycleBin() {
    requireUnlocked();
    vault = logActivity(touchVault(RecycleBinService.clear(vault)), 'recycleBin.emptied');
    persist();
    emitVaultEvent('recycleBin.emptied');
  }

  // ---- settings --------------------------------------------------------

  function getSettings() {
    requireUnlocked();
    return vault.settings;
  }

  function updateVaultSettings(updates) {
    requireUnlocked();
    vault = touchVault({ ...vault, settings: SettingsService.update(vault.settings, updates) });
    persist();
    emitVaultEvent('settings.updated');
    return vault.settings;
  }

  // ---- import / export --------------------------------------------------

  function exportVaultTo(destPath) {
    requireUnlocked();
    persist(); // ensure the file on disk reflects the in-memory state first
    VaultRepository.exportTo(vaultFilePath, destPath);
  }

  /**
   * Replaces the live vault with an external .xam file after verifying it
   * can be decrypted with the provided password. The current vault is
   * backed up first so the operation is reversible.
   */
  function importVaultFrom(sourcePath, password) {
    const { vault: decrypted, sessionKey: newKey, salt: newSalt } = VaultRepository.importFrom(
      sourcePath,
      password,
    ); // throws if wrong password
    if (!isVaultValid(decrypted)) {
      throw new Error('Import file is not a valid vault');
    }

    VaultRepository.replaceLiveFile(sourcePath, vaultFilePath, backupDir, decrypted.settings.backupCount || 10);

    wipeKeyMaterial();
    salt = newSalt;
    sessionKey = newKey;
    vault = logActivity(touchVault(decrypted), 'vault.imported');
    persist();
    emitVaultEvent('vault.imported');
  }

  // ---- backups ------------------------------------------------------------

  function listBackups() {
    return VaultRepository.listBackups(backupDir);
  }

  // Deliberately callable while locked (or even while the live vault file
  // is unreadable/corrupted) - this is the whole point of it as a
  // recovery path. Falls back to the model's default backupCount (10)
  // when there's no unlocked vault to read the real setting from.
  function restoreBackup(backupPath) {
    const keepCount = isUnlocked() ? getSettings().backupCount : 10;
    VaultRepository.restoreBackup(backupPath, vaultFilePath, backupDir, keepCount);
    if (isUnlocked()) lock();
  }

  // ---- search ------------------------------------------------------------

  function search(query) {
    requireUnlocked();
    return SearchService.search(vault, query);
  }

  return {
    vaultFileExists,
    isVaultFileHealthy,
    isUnlocked,
    lock,
    create,
    unlock,
    getVault,
    restoreSnapshot,
    changeMasterPassword,
    addCategory,
    renameCategory,
    deleteCategory,
    addFolder,
    renameFolder,
    deleteFolder,
    moveFolder,
    addEntry,
    updateEntryFields,
    deleteEntry,
    moveEntry,
    duplicateEntryById,
    toggleFavorite,
    listFavorites,
    listRecentActivity,
    recordError,
    restoreFromRecycleBin,
    permanentlyDelete,
    emptyRecycleBin,
    getSettings,
    updateVaultSettings,
    exportVaultTo,
    importVaultFrom,
    listBackups,
    restoreBackup,
    search,
  };
}
