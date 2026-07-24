const { contextBridge, ipcRenderer } = require('electron');

// Every method here is a thin wrapper around ipcRenderer.invoke. The
// renderer never touches Node's fs/crypto directly - all vault access is
// mediated by the main process (see electron.js + src/services).
contextBridge.exposeInMainWorld('electron', {
  // ---- window ----
  setWindowMode: (mode) => ipcRenderer.invoke('set-window-mode', mode),

  // ---- master password / vault lifecycle ----
  // Names kept stable (checkMasterPasswordExists / setMasterPassword /
  // verifyMasterPassword) so the existing Login screen keeps working
  // unchanged against the new vault-backed implementation.
  checkMasterPasswordExists: () => ipcRenderer.invoke('check-master-password-exists'),
  checkVaultHealth: () => ipcRenderer.invoke('check-vault-health'),
  setMasterPassword: (password) => ipcRenderer.invoke('set-master-password', password),
  verifyMasterPassword: (password) => ipcRenderer.invoke('verify-master-password', password),
  lockVault: () => ipcRenderer.invoke('lock-vault'),
  changeMasterPassword: (currentPassword, newPassword) =>
    ipcRenderer.invoke('change-master-password', currentPassword, newPassword),
  // Generalized push channel for domain events (category/folder/entry
  // mutations, vault lifecycle transitions) - callback receives
  // { action, details, timestamp }.
  onVaultEvent: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('vault-event', listener);
    return () => ipcRenderer.removeListener('vault-event', listener);
  },

  // ---- categories ----
  getVaultTree: () => ipcRenderer.invoke('get-vault-tree'),
  addCategory: (name, icon) => ipcRenderer.invoke('add-category', name, icon),
  renameCategory: (categoryId, name) => ipcRenderer.invoke('rename-category', categoryId, name),
  deleteCategory: (categoryId) => ipcRenderer.invoke('delete-category', categoryId),

  // ---- folders ----
  addFolder: (categoryId, parentFolderId, name) =>
    ipcRenderer.invoke('add-folder', categoryId, parentFolderId, name),
  renameFolder: (categoryId, folderId, name) => ipcRenderer.invoke('rename-folder', categoryId, folderId, name),
  deleteFolder: (categoryId, folderId) => ipcRenderer.invoke('delete-folder', categoryId, folderId),
  moveFolder: (folderId, targetCategoryId, targetParentFolderId) =>
    ipcRenderer.invoke('move-folder', folderId, targetCategoryId, targetParentFolderId),

  // ---- entries ----
  addEntry: (categoryId, folderId, entryData) => ipcRenderer.invoke('add-entry', categoryId, folderId, entryData),
  updateEntry: (entryId, updates) => ipcRenderer.invoke('update-entry', entryId, updates),
  deleteEntry: (entryId) => ipcRenderer.invoke('delete-entry', entryId),
  moveEntry: (entryId, targetCategoryId, targetFolderId) =>
    ipcRenderer.invoke('move-entry', entryId, targetCategoryId, targetFolderId),
  duplicateEntry: (entryId) => ipcRenderer.invoke('duplicate-entry', entryId),
  toggleFavorite: (entryId) => ipcRenderer.invoke('toggle-favorite', entryId),
  listFavorites: () => ipcRenderer.invoke('list-favorites'),
  listRecentActivity: (limit) => ipcRenderer.invoke('list-recent-activity', limit),
  listRecentEntries: (limit) => ipcRenderer.invoke('list-recent-entries', limit),
  findReusedPasswords: () => ipcRenderer.invoke('find-reused-passwords'),
  recordError: (message, stack) => ipcRenderer.invoke('record-error', message, stack),

  // ---- recycle bin ----
  getRecycleBin: () => ipcRenderer.invoke('get-recycle-bin'),
  restoreFromRecycleBin: (recycleId) => ipcRenderer.invoke('restore-from-recycle-bin', recycleId),
  permanentlyDelete: (recycleId) => ipcRenderer.invoke('permanently-delete', recycleId),
  emptyRecycleBin: () => ipcRenderer.invoke('empty-recycle-bin'),

  // ---- undo / redo ----
  undo: () => ipcRenderer.invoke('undo'),
  redo: () => ipcRenderer.invoke('redo'),
  getUndoState: () => ipcRenderer.invoke('get-undo-state'),

  // ---- search ----
  searchVault: (query) => ipcRenderer.invoke('search-vault', query),

  // ---- settings ----
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (updates) => ipcRenderer.invoke('update-settings', updates),

  // ---- backup / import / export ----
  listBackups: () => ipcRenderer.invoke('list-backups'),
  restoreBackup: (backupPath) => ipcRenderer.invoke('restore-backup', backupPath),
  deleteBackup: (backupPath) => ipcRenderer.invoke('delete-backup', backupPath),
  renameBackup: (backupPath, newLabel) => ipcRenderer.invoke('rename-backup', backupPath, newLabel),
  exportBackup: (backupPath) => ipcRenderer.invoke('export-backup', backupPath),
  exportVault: () => ipcRenderer.invoke('export-vault'),
  importVault: (password) => ipcRenderer.invoke('import-vault', password),
});
