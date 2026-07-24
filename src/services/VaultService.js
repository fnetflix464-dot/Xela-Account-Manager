const { randomUUID } = require('crypto');
const path = require('path');

const CryptoService = require('./CryptoService');
const FileService = require('./FileService');
const BackupService = require('./BackupService');

const { createVault, touchVault, logActivity, isVaultValid } = require('../models/Vault');
const { createCategory } = require('../models/Category');
const { createFolder, findFolderById, findParentFolder } = require('../models/Folder');
const { createEntry, updateEntry: applyEntryUpdate, duplicateEntry } = require('../models/Entry');
const { updateField } = require('../models/Field');
const { updateSettings: applySettingsUpdate } = require('../models/Settings');

const MAX_PASSWORD_HISTORY = 20;

/**
 * VaultService holds all runtime state for a single unlocked vault session
 * (the derived key and the decrypted vault object live only in memory,
 * never on disk in plaintext). It is instantiated once per app run in the
 * Electron main process.
 */
function createVaultService({ vaultFilePath, backupDir }) {
  let sessionKey = null; // Buffer - derived AES key, present only while unlocked
  let salt = null; // Buffer - PBKDF2 salt read from / written to the vault file
  let vault = null; // decrypted Vault object, present only while unlocked

  // ---- session -------------------------------------------------------

  function vaultFileExists() {
    return FileService.pathExists(vaultFilePath);
  }

  function isUnlocked() {
    return sessionKey !== null && vault !== null;
  }

  function requireUnlocked() {
    if (!isUnlocked()) {
      throw new Error('Vault is locked');
    }
  }

  function lock() {
    sessionKey = null;
    salt = null;
    vault = null;
  }

  /**
   * Persists the in-memory vault to disk: rotate a backup of the previous
   * file, then encrypt + atomically write the current state.
   */
  function persist() {
    requireUnlocked();
    BackupService.createBackup(vaultFilePath, backupDir, vault.settings.backupCount);
    const envelope = CryptoService.encryptObject(vault, sessionKey);
    FileService.writeVaultFile(vaultFilePath, {
      salt: salt.toString('base64'),
      ...envelope,
    });
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

    salt = CryptoService.generateSalt();
    sessionKey = CryptoService.deriveKey(masterPassword, salt);
    vault = logActivity(createVault(), 'vault.created');
    persist();
    return true;
  }

  /**
   * Attempts to unlock the vault with the given password. Returns true on
   * success; throws on wrong password / missing / corrupted vault.
   */
  function unlock(masterPassword) {
    const envelope = FileService.readVaultFile(vaultFilePath);
    const candidateSalt = Buffer.from(envelope.salt, 'base64');
    const candidateKey = CryptoService.deriveKey(masterPassword, candidateSalt);

    const decrypted = CryptoService.decryptObject(envelope, candidateKey); // throws if wrong password
    if (!isVaultValid(decrypted)) {
      throw new Error('Vault file is corrupted');
    }

    salt = candidateSalt;
    sessionKey = candidateKey;
    vault = decrypted;
    return true;
  }

  function getVault() {
    requireUnlocked();
    return vault;
  }

  function changeMasterPassword(currentPassword, newPassword) {
    requireUnlocked();
    const candidateKey = CryptoService.deriveKey(currentPassword, salt);
    if (Buffer.compare(candidateKey, sessionKey) !== 0) {
      throw new Error('Current password is incorrect');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New master password must be at least 8 characters');
    }
    salt = CryptoService.generateSalt();
    sessionKey = CryptoService.deriveKey(newPassword, salt);
    vault = logActivity(touchVault(vault), 'vault.masterPasswordChanged');
    persist();
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
  }

  function deleteCategory(categoryId) {
    requireUnlocked();
    const category = vault.categories.find((c) => c.id === categoryId);
    if (!category) throw new Error('Category not found');

    const recycled = {
      id: randomUUID(),
      type: 'category',
      item: category,
      deletedAt: new Date().toISOString(),
    };
    vault = logActivity(
      touchVault({
        ...vault,
        categories: vault.categories.filter((c) => c.id !== categoryId),
        recycleBin: [recycled, ...vault.recycleBin],
      }),
      'category.deleted',
      { categoryId, name: category.name },
    );
    persist();
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
    return newFolder;
  }

  function renameFolder(categoryId, folderId, name) {
    requireUnlocked();
    mutateFolder(categoryId, folderId, (f) => ({ ...f, name, updatedAt: new Date().toISOString() }));
    vault = logActivity(touchVault(vault), 'folder.renamed', { folderId, name });
    persist();
  }

  function deleteFolder(categoryId, folderId) {
    requireUnlocked();
    const located = locateFolder(folderId);
    if (!located) throw new Error('Folder not found');

    const recycled = {
      id: randomUUID(),
      type: 'folder',
      item: located.folder,
      categoryId,
      deletedAt: new Date().toISOString(),
    };

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

    vault = logActivity(touchVault({ ...vault, recycleBin: [recycled, ...vault.recycleBin] }), 'folder.deleted', {
      folderId,
      name: located.folder.name,
    });
    persist();
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

        const isSecret = existing.type === 'password' || existing.type === 'pin';
        const history = isSecret
          ? [{ value: existing.value, changedAt: existing.updatedAt }, ...(existing.history || [])].slice(
              0,
              MAX_PASSWORD_HISTORY,
            )
          : existing.history;

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
    return updatedEntry;
  }

  function deleteEntry(entryId) {
    requireUnlocked();
    const located = locateEntry(entryId);
    if (!located) throw new Error('Entry not found');

    const recycled = {
      id: randomUUID(),
      type: 'entry',
      item: located.entry,
      categoryId: located.category.id,
      folderId: located.folder.id,
      deletedAt: new Date().toISOString(),
    };

    mutateFolder(located.category.id, located.folder.id, (f) => ({
      ...f,
      entries: f.entries.filter((e) => e.id !== entryId),
    }));
    vault = logActivity(touchVault({ ...vault, recycleBin: [recycled, ...vault.recycleBin] }), 'entry.deleted', {
      entryId,
      title: located.entry.title,
    });
    persist();
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
  }

  function duplicateEntryById(entryId) {
    requireUnlocked();
    const located = locateEntry(entryId);
    if (!located) throw new Error('Entry not found');
    const copy = duplicateEntry(located.entry);
    mutateFolder(located.category.id, located.folder.id, (f) => ({ ...f, entries: [...f.entries, copy] }));
    vault = logActivity(touchVault(vault), 'entry.duplicated', { entryId, copyId: copy.id });
    persist();
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
    return vault.activityLog.slice(0, limit);
  }

  // ---- recycle bin ---------------------------------------------------

  function restoreFromRecycleBin(recycleId) {
    requireUnlocked();
    const record = vault.recycleBin.find((r) => r.id === recycleId);
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
      touchVault({ ...vault, recycleBin: vault.recycleBin.filter((r) => r.id !== recycleId) }),
      'recycleBin.restored',
      { recycleId, type: record.type },
    );
    persist();
  }

  function permanentlyDelete(recycleId) {
    requireUnlocked();
    vault = logActivity(
      touchVault({ ...vault, recycleBin: vault.recycleBin.filter((r) => r.id !== recycleId) }),
      'recycleBin.permanentlyDeleted',
      { recycleId },
    );
    persist();
  }

  function emptyRecycleBin() {
    requireUnlocked();
    vault = logActivity(touchVault({ ...vault, recycleBin: [] }), 'recycleBin.emptied');
    persist();
  }

  // ---- settings --------------------------------------------------------

  function getSettings() {
    requireUnlocked();
    return vault.settings;
  }

  function updateVaultSettings(updates) {
    requireUnlocked();
    vault = touchVault({ ...vault, settings: applySettingsUpdate(vault.settings, updates) });
    persist();
    return vault.settings;
  }

  // ---- import / export --------------------------------------------------

  function exportVaultTo(destPath) {
    requireUnlocked();
    persist(); // ensure the file on disk reflects the in-memory state first
    FileService.copyFile(vaultFilePath, destPath);
  }

  /**
   * Replaces the live vault with an external .xam file after verifying it
   * can be decrypted with the provided password. The current vault is
   * backed up first so the operation is reversible.
   */
  function importVaultFrom(sourcePath, password) {
    const envelope = FileService.readVaultFile(sourcePath);
    const candidateSalt = Buffer.from(envelope.salt, 'base64');
    const candidateKey = CryptoService.deriveKey(password, candidateSalt);
    const decrypted = CryptoService.decryptObject(envelope, candidateKey); // throws if wrong password
    if (!isVaultValid(decrypted)) {
      throw new Error('Import file is not a valid vault');
    }

    if (vaultFileExists()) {
      BackupService.createBackup(vaultFilePath, backupDir, decrypted.settings.backupCount || 10);
    }
    FileService.copyFile(sourcePath, vaultFilePath);

    salt = candidateSalt;
    sessionKey = candidateKey;
    vault = logActivity(touchVault(decrypted), 'vault.imported');
    persist();
  }

  // ---- search ------------------------------------------------------------

  function search(query) {
    requireUnlocked();
    // eslint-disable-next-line global-require
    const SearchService = require('./SearchService');
    return SearchService.search(vault, query);
  }

  return {
    vaultFileExists,
    isUnlocked,
    lock,
    create,
    unlock,
    getVault,
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
    restoreFromRecycleBin,
    permanentlyDelete,
    emptyRecycleBin,
    getSettings,
    updateVaultSettings,
    exportVaultTo,
    importVaultFrom,
    search,
  };
}

module.exports = { createVaultService };
