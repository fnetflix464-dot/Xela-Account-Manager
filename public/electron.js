const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const isDev = require('electron-is-dev');
const path = require('path');

const { createVaultService } = require('../src/services/VaultService');

let mainWindow;
let vaultService;
let autoLockTimer = null;

function vaultFilePath() {
  return path.join(app.getPath('userData'), 'vault.xam');
}

function backupDirPath() {
  return path.join(app.getPath('userData'), 'backups');
}

function initializeVaultService() {
  vaultService = createVaultService({
    vaultFilePath: vaultFilePath(),
    backupDir: backupDirPath(),
  });
}

// ---- auto-lock -------------------------------------------------------
// Any successful IPC call resets the idle timer. When it fires, the vault
// is locked in memory and the renderer is notified to show the unlock
// screen again. Purely local - no network, no telemetry.
function resetAutoLockTimer() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (!vaultService || !vaultService.isUnlocked()) return;

  let minutes = 5;
  try {
    minutes = vaultService.getSettings().autoLockMinutes;
  } catch {
    // vault locked mid-read; ignore
  }
  if (!minutes || minutes <= 0) return; // 0/undefined disables auto-lock

  autoLockTimer = setTimeout(() => {
    if (vaultService && vaultService.isUnlocked()) {
      vaultService.lock();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vault-auto-locked');
      }
    }
  }, minutes * 60 * 1000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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

app.on('ready', () => {
  initializeVaultService();
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
// { success, data|error }, and reset the auto-lock idle timer on success.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const data = await fn(...args);
      resetAutoLockTimer();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

// ==================== MASTER PASSWORD / VAULT LIFECYCLE ====================

handle('check-master-password-exists', () => ({ exists: vaultService.vaultFileExists() }));

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
handle('add-category', (name, icon) => vaultService.addCategory(name, icon));
handle('rename-category', (categoryId, name) => vaultService.renameCategory(categoryId, name));
handle('delete-category', (categoryId) => vaultService.deleteCategory(categoryId));

// ==================== FOLDERS ====================

handle('add-folder', (categoryId, parentFolderId, name) =>
  vaultService.addFolder(categoryId, parentFolderId, name),
);
handle('rename-folder', (categoryId, folderId, name) => vaultService.renameFolder(categoryId, folderId, name));
handle('delete-folder', (categoryId, folderId) => vaultService.deleteFolder(categoryId, folderId));
handle('move-folder', (folderId, targetCategoryId, targetParentFolderId) =>
  vaultService.moveFolder(folderId, targetCategoryId, targetParentFolderId),
);

// ==================== ENTRIES ====================

handle('add-entry', (categoryId, folderId, entryData) =>
  vaultService.addEntry(categoryId, folderId, entryData),
);
handle('update-entry', (entryId, updates) => vaultService.updateEntryFields(entryId, updates));
handle('delete-entry', (entryId) => vaultService.deleteEntry(entryId));
handle('move-entry', (entryId, targetCategoryId, targetFolderId) =>
  vaultService.moveEntry(entryId, targetCategoryId, targetFolderId),
);
handle('duplicate-entry', (entryId) => vaultService.duplicateEntryById(entryId));
handle('toggle-favorite', (entryId) => vaultService.toggleFavorite(entryId));
handle('list-favorites', () => vaultService.listFavorites());
handle('list-recent-activity', (limit) => vaultService.listRecentActivity(limit));

// ==================== RECYCLE BIN ====================

handle('get-recycle-bin', () => vaultService.getVault().recycleBin);
handle('restore-from-recycle-bin', (recycleId) => vaultService.restoreFromRecycleBin(recycleId));
handle('permanently-delete', (recycleId) => vaultService.permanentlyDelete(recycleId));
handle('empty-recycle-bin', () => vaultService.emptyRecycleBin());

// ==================== SEARCH ====================

handle('search-vault', (query) => vaultService.search(query));

// ==================== SETTINGS ====================

handle('get-settings', () => vaultService.getSettings());
handle('update-settings', (updates) => vaultService.updateVaultSettings(updates));

// ==================== BACKUP / IMPORT / EXPORT ====================

handle('list-backups', () => {
  const BackupService = require('../src/services/BackupService');
  return BackupService.listBackups(backupDirPath());
});

handle('restore-backup', (backupPath) => {
  const BackupService = require('../src/services/BackupService');
  BackupService.restoreBackup(backupPath, vaultFilePath(), backupDirPath(), vaultService.getSettings().backupCount);
  vaultService.lock();
  return true;
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
