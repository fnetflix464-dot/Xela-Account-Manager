const { app, BrowserWindow, ipcMain, dialog, powerMonitor } = require('electron');
const isDev = require('electron-is-dev');
const path = require('path');

// public/electron.js stays CommonJS: Electron's ESM support for the main
// process does not correctly resolve the 'electron' built-in module when
// loaded via `import` (verified - it either fails to link entirely or
// falls back to the plain path-string export that `require('electron')`
// returns outside of a real Electron process). `src/services/VaultService`
// and everything under it are genuine ES Modules; a CommonJS file can
// still consume them via dynamic `import()`, which is the officially
// supported CJS-consumes-ESM interop path.
let vaultService;
let commandManager;
let createVaultMutationCommand;
let idleLockService;

let mainWindow;

// The Login/Unlock screen is a small centered card - no reason to open
// the full app-sized window behind it. The window resizes between these
// two presets as the renderer moves between authenticated/unauthenticated.
const LOGIN_WINDOW = { width: 520, height: 700, minWidth: 460, minHeight: 600 };
const APP_WINDOW = { width: 1280, height: 840, minWidth: 900, minHeight: 600 };

function setWindowMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const size = mode === 'app' ? APP_WINDOW : LOGIN_WINDOW;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setMinimumSize(size.minWidth, size.minHeight);
  mainWindow.setSize(size.width, size.height);
  mainWindow.center();
}

function vaultFilePath() {
  return path.join(app.getPath('userData'), 'vault.xam');
}

function backupDirPath() {
  return path.join(app.getPath('userData'), 'backups');
}

async function initializeVaultService() {
  const { createVaultService } = await import('../src/services/VaultService.js');
  const { eventBus, VAULT_EVENT_CHANNEL } = await import('../src/services/EventBus.js');
  const { createCommandManager } = await import('../src/commands/CommandManager.js');
  const { createIdleLockService } = await import('../src/services/IdleLockService.js');
  ({ createVaultMutationCommand } = await import('../src/commands/VaultMutationCommand.js'));

  vaultService = createVaultService({
    vaultFilePath: vaultFilePath(),
    backupDir: backupDirPath(),
  });
  commandManager = createCommandManager();
  idleLockService = createIdleLockService({ powerMonitor });

  // Forward every domain event (category/folder/entry mutations, vault
  // lifecycle transitions, undo/redo stack changes) to the renderer on
  // one generalized channel. This replaces the old single-purpose
  // 'vault-auto-locked' push - the renderer now reacts to
  // `event.action === 'vault.locked'` the same way whether the lock
  // happened via idle auto-lock or a direct IPC call.
  eventBus.on(VAULT_EVENT_CHANNEL, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(VAULT_EVENT_CHANNEL, event);
    }
    handleIdleLockLifecycle(event);
  });
}

// ---- idle auto-lock ---------------------------------------------------
// Polls real OS idle time (see src/services/IdleLockService.js) rather
// than resetting a timer on every IPC call - (re)started whenever the
// vault becomes unlocked or its autoLockMinutes setting changes, stopped
// the moment it locks (nothing to poll for while locked).
function handleIdleLockLifecycle(event) {
  if (event.action === 'vault.created' || event.action === 'vault.unlocked' || event.action === 'settings.updated') {
    if (vaultService.isUnlocked()) {
      idleLockService.start(vaultService.getSettings().autoLockMinutes, () => {
        if (vaultService.isUnlocked()) vaultService.lock();
      });
    }
  } else if (event.action === 'vault.locked') {
    idleLockService.stop();
  }
}

// Runs `run` as an undoable command (see src/commands/). Used only for
// mutations that make sense to snapshot/restore wholesale - excluded are
// settings changes, master-password/import/restore-backup (which change
// the vault's encryption identity, not just its content), and permanent
// deletion (the UI explicitly promises those "cannot be undone").
function withUndo(label, run) {
  return commandManager.execute(createVaultMutationCommand(vaultService, label, run));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: LOGIN_WINDOW.width,
    height: LOGIN_WINDOW.height,
    minWidth: LOGIN_WINDOW.minWidth,
    minHeight: LOGIN_WINDOW.minHeight,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../build/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', async () => {
  await initializeVaultService();
  createWindow();
});

app.on('window-all-closed', () => {
  if (vaultService && vaultService.isUnlocked()) {
    vaultService.lock();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Every IPC handler below is wrapped the same way: try/catch, return
// { success, data|error }. Auto-lock is driven by real OS idle time (see
// handleIdleLockLifecycle above), not by IPC activity, so there is
// nothing to reset here.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const data = await fn(...args);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

// ==================== WINDOW ====================

handle('set-window-mode', (mode) => {
  setWindowMode(mode);
  return true;
});

// ==================== MASTER PASSWORD / VAULT LIFECYCLE ====================

handle('check-master-password-exists', () => ({ exists: vaultService.vaultFileExists() }));
// Callable before any password is entered - a structurally broken vault
// file should be flagged immediately rather than only ever surfacing as
// a mysterious "incorrect password" on every unlock attempt.
handle('check-vault-health', () => ({ healthy: vaultService.isVaultFileHealthy() }));

handle('set-master-password', (password) => {
  vaultService.create(password);
  return true;
});

handle('verify-master-password', (password) => {
  vaultService.unlock(password);
  return true;
});

handle('lock-vault', () => {
  vaultService.lock();
  return true;
});

handle('change-master-password', (currentPassword, newPassword) =>
  vaultService.changeMasterPassword(currentPassword, newPassword),
);

// ==================== CATEGORIES ====================

handle('get-vault-tree', () => vaultService.getVault().categories);
handle('add-category', (name, icon) => withUndo('Add category', () => vaultService.addCategory(name, icon)));
handle('rename-category', (categoryId, name) =>
  withUndo('Rename category', () => vaultService.renameCategory(categoryId, name)),
);
handle('delete-category', (categoryId) =>
  withUndo('Delete category', () => vaultService.deleteCategory(categoryId)),
);

// ==================== FOLDERS ====================

handle('add-folder', (categoryId, parentFolderId, name) =>
  withUndo('Add folder', () => vaultService.addFolder(categoryId, parentFolderId, name)),
);
handle('rename-folder', (categoryId, folderId, name) =>
  withUndo('Rename folder', () => vaultService.renameFolder(categoryId, folderId, name)),
);
handle('delete-folder', (categoryId, folderId) =>
  withUndo('Delete folder', () => vaultService.deleteFolder(categoryId, folderId)),
);
handle('move-folder', (folderId, targetCategoryId, targetParentFolderId) =>
  withUndo('Move folder', () => vaultService.moveFolder(folderId, targetCategoryId, targetParentFolderId)),
);

// ==================== ENTRIES ====================

handle('add-entry', (categoryId, folderId, entryData) =>
  withUndo('Add entry', () => vaultService.addEntry(categoryId, folderId, entryData)),
);
handle('update-entry', (entryId, updates) =>
  withUndo('Update entry', () => vaultService.updateEntryFields(entryId, updates)),
);
handle('delete-entry', (entryId) => withUndo('Delete entry', () => vaultService.deleteEntry(entryId)));
handle('move-entry', (entryId, targetCategoryId, targetFolderId) =>
  withUndo('Move entry', () => vaultService.moveEntry(entryId, targetCategoryId, targetFolderId)),
);
handle('duplicate-entry', (entryId) =>
  withUndo('Duplicate entry', () => vaultService.duplicateEntryById(entryId)),
);
handle('toggle-favorite', (entryId) => withUndo('Toggle favorite', () => vaultService.toggleFavorite(entryId)));
handle('list-favorites', () => vaultService.listFavorites());
handle('list-recent-entries', (limit) => vaultService.listRecentEntries(limit));
handle('list-recent-activity', (limit) => vaultService.listRecentActivity(limit));
handle('find-reused-passwords', () => vaultService.findReusedPasswords());
handle('record-error', (message, stack) => {
  vaultService.recordError(message, stack);
  return true;
});

// ==================== RECYCLE BIN ====================

handle('get-recycle-bin', () => vaultService.getVault().recycleBin);
handle('restore-from-recycle-bin', (recycleId) =>
  withUndo('Restore from recycle bin', () => vaultService.restoreFromRecycleBin(recycleId)),
);
// Permanent deletion is intentionally NOT undoable - the Recycle Bin UI
// explicitly tells the user these actions "cannot be undone".
handle('permanently-delete', (recycleId) => vaultService.permanentlyDelete(recycleId));
handle('empty-recycle-bin', () => vaultService.emptyRecycleBin());

// ==================== UNDO / REDO ====================

handle('undo', () => commandManager.undo());
handle('redo', () => commandManager.redo());
handle('get-undo-state', () => ({ canUndo: commandManager.canUndo(), canRedo: commandManager.canRedo() }));

// ==================== SEARCH ====================

handle('search-vault', (query) => vaultService.search(query));

// ==================== SETTINGS ====================

handle('get-settings', () => vaultService.getSettings());
handle('update-settings', (updates) => vaultService.updateVaultSettings(updates));

// ==================== BACKUP / IMPORT / EXPORT ====================

handle('list-backups', () => vaultService.listBackups());

handle('restore-backup', (backupPath) => {
  vaultService.restoreBackup(backupPath);
  return true;
});

handle('delete-backup', (backupPath) => {
  vaultService.deleteBackup(backupPath);
  return true;
});

handle('rename-backup', (backupPath, newLabel) => vaultService.renameBackup(backupPath, newLabel));

handle('export-backup', async (backupPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Backup',
    defaultPath: path.basename(backupPath),
    filters: [{ name: 'Xela Vault Backup', extensions: ['bak'] }],
  });
  if (result.canceled || !result.filePath) return null;
  vaultService.exportBackupTo(backupPath, result.filePath);
  return result.filePath;
});

handle('export-vault', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Vault',
    defaultPath: 'vault-export.xam',
    filters: [{ name: 'Xela Vault', extensions: ['xam'] }],
  });
  if (result.canceled || !result.filePath) return null;
  vaultService.exportVaultTo(result.filePath);
  return result.filePath;
});

handle('import-vault', async (password) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Vault',
    filters: [{ name: 'Xela Vault', extensions: ['xam'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  vaultService.importVaultFrom(result.filePaths[0], password);
  return result.filePaths[0];
});
