// Installs window.electron when running under Tauri, shaped identically
// to what public/preload.cjs's contextBridge exposed under Electron -
// same method names, same argument order, same { success, data } /
// { success, error } envelope on every call (preload.cjs just forwarded
// ipcRenderer.invoke(), which resolved to whatever electron.js's handle()
// wrapper produced; Tauri's invoke() instead resolves directly to the
// command's return value or rejects with an error string, so this file
// re-wraps every call to keep that envelope). Every existing component/
// hook in src/ checks `result.success`/`result.data` - keeping that shape
// here means none of those call sites need to change.
//
// Only installs itself under an actual Tauri runtime, and only if
// window.electron isn't already set - so an Electron build (preload.cjs)
// keeps working completely unchanged during the migration.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

async function call(command, args) {
  try {
    const data = await invoke(command, args);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : String(error?.message || error) };
  }
}

function installBridge() {
  window.electron = {
    // ---- window ----
    setWindowMode: (mode) => call('set_window_mode', { mode }),

    // ---- master password / vault lifecycle ----
    checkMasterPasswordExists: () => call('check_master_password_exists'),
    checkVaultHealth: () => call('check_vault_health'),
    setMasterPassword: (password) => call('set_master_password', { password }),
    verifyMasterPassword: (password) => call('verify_master_password', { password }),
    lockVault: () => call('lock_vault'),
    changeMasterPassword: (currentPassword, newPassword) =>
      call('change_master_password', { currentPassword, newPassword }),
    isQuickUnlockAvailable: () => call('is_quick_unlock_available'),
    isQuickUnlockEnabled: () => call('is_quick_unlock_enabled'),
    enableQuickUnlock: (pin) => call('enable_quick_unlock', { pin }),
    disableQuickUnlock: () => call('disable_quick_unlock'),
    unlockWithPin: (pin) => call('unlock_with_pin', { pin }),
    // Tauri's listen() is async (resolves to the unlisten fn) but every
    // call site treats onVaultEvent's return value as an immediately-
    // usable unsubscribe function (e.g. a useEffect cleanup) - queue the
    // unlisten call if it hasn't resolved yet by the time cleanup runs.
    onVaultEvent: (callback) => {
      let unlisten = null;
      let cancelled = false;
      listen('vault-event', (event) => callback(event.payload)).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
      return () => {
        cancelled = true;
        if (unlisten) unlisten();
      };
    },

    // ---- categories ----
    getVaultTree: () => call('get_vault_tree'),
    addCategory: (name, icon) => call('add_category', { name, icon }),
    renameCategory: (categoryId, name) => call('rename_category', { categoryId, name }),
    deleteCategory: (categoryId) => call('delete_category', { categoryId }),

    // ---- folders ----
    addFolder: (categoryId, parentFolderId, name) => call('add_folder', { categoryId, parentFolderId, name }),
    renameFolder: (categoryId, folderId, name) => call('rename_folder', { categoryId, folderId, name }),
    deleteFolder: (categoryId, folderId) => call('delete_folder', { categoryId, folderId }),
    moveFolder: (folderId, targetCategoryId, targetParentFolderId, beforeFolderId) =>
      call('move_folder', { folderId, targetCategoryId, targetParentFolderId, beforeFolderId }),

    // ---- entries ----
    addEntry: (categoryId, folderId, entryData) => call('add_entry', { categoryId, folderId, entryData }),
    updateEntry: (entryId, updates) => call('update_entry', { entryId, updates }),
    deleteEntry: (entryId) => call('delete_entry', { entryId }),
    moveEntry: (entryId, targetCategoryId, targetFolderId) =>
      call('move_entry', { entryId, targetCategoryId, targetFolderId }),
    duplicateEntry: (entryId) => call('duplicate_entry', { entryId }),
    toggleFavorite: (entryId) => call('toggle_favorite', { entryId }),
    listFavorites: () => call('list_favorites'),
    listRecentActivity: (limit) => call('list_recent_activity', { limit }),
    listRecentEntries: (limit) => call('list_recent_entries', { limit }),
    findReusedPasswords: () => call('find_reused_passwords'),
    recordError: (message, stack) => call('record_error', { message, stack }),

    // ---- recycle bin ----
    getRecycleBin: () => call('get_recycle_bin'),
    restoreFromRecycleBin: (recycleId) => call('restore_from_recycle_bin', { recycleId }),
    permanentlyDelete: (recycleId) => call('permanently_delete', { recycleId }),
    emptyRecycleBin: () => call('empty_recycle_bin'),

    // ---- undo / redo ----
    undo: () => call('undo'),
    redo: () => call('redo'),
    getUndoState: () => call('get_undo_state'),

    // ---- search ----
    searchVault: (query) => call('search_vault', { query }),

    // ---- settings ----
    getSettings: () => call('get_settings'),
    updateSettings: (updates) => call('update_settings', { updates }),

    // ---- backup / import / export ----
    listBackups: () => call('list_backups'),
    restoreBackup: (backupPath) => call('restore_backup', { backupPath }),
    deleteBackup: (backupPath) => call('delete_backup', { backupPath }),
    renameBackup: (backupPath, newLabel) => call('rename_backup', { backupPath, newLabel }),
    exportBackup: (backupPath) => call('export_backup', { backupPath }),
    exportVault: () => call('export_vault'),
    importVault: (password) => call('import_vault', { password }),
  };
}

if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ && !window.electron) {
  installBridge();
}
