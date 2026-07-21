const { app, BrowserWindow, ipcMain } = require('electron');
const isDev = require('electron-is-dev');
const path = require('path');
const AccountDatabase = require('./database');

let mainWindow;
let db;

// Initialize database
function initializeDatabase() {
  db = new AccountDatabase();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
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
  initializeDatabase();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ==================== IPC HANDLERS ====================

// MASTER PASSWORD HANDLERS
ipcMain.handle('set-master-password', (event, password) => {
  try {
    db.setMasterPassword(password);
    return { success: true, message: 'Master password set successfully' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('verify-master-password', (event, password) => {
  try {
    const isValid = db.verifyMasterPassword(password);
    return { success: isValid, message: isValid ? 'Authenticated' : 'Invalid password' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-master-password-exists', () => {
  try {
    const hash = db.getSetting('masterPasswordHash');
    return { exists: !!hash };
  } catch (error) {
    return { exists: false, error: error.message };
  }
});

// ACCOUNT HANDLERS
ipcMain.handle('add-account', (event, account) => {
  try {
    const result = db.addAccount(account);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-accounts', () => {
  try {
    const accounts = db.getAccounts();
    return { success: true, data: accounts };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-account', (event, id) => {
  try {
    const account = db.getAccount(id);
    return { success: true, data: account };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-account', (event, id, account) => {
  try {
    const result = db.updateAccount(id, account);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-account', (event, id) => {
  try {
    db.deleteAccount(id);
    return { success: true, message: 'Account deleted' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// PASSWORD STRENGTH HANDLER
ipcMain.handle('validate-password-strength', (event, password) => {
  try {
    const strength = db.calculatePasswordStrength(password);
    return { success: true, strength };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 2FA HANDLERS
ipcMain.handle('enable-2fa', (event, accountId, method, backupCodes) => {
  try {
    const result = db.enable2FA(accountId, method, backupCodes);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disable-2fa', (event, accountId) => {
  try {
    const result = db.disable2FA(accountId);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-2fa-status', (event, accountId) => {
  try {
    const status = db.get2FAStatus(accountId);
    return { success: true, data: status };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// BACKUP HANDLERS
ipcMain.handle('create-backup', () => {
  try {
    const backup = db.createBackup();
    return { success: true, data: backup };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-auto-backup', () => {
  try {
    const backup = db.createAutoBackup();
    return { success: true, data: backup };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restore-backup', (event, backupData) => {
  try {
    const result = db.restoreBackup(backupData);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-backup-history', (event, limit = 10) => {
  try {
    const backups = db.getBackupHistory(limit);
    return { success: true, data: backups };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// SECURITY HANDLERS
ipcMain.handle('get-security-stats', () => {
  try {
    const stats = db.getSecurityStats();
    return { success: true, data: stats };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-audit-log', (event, limit = 50) => {
  try {
    const logs = db.getAuditLog(limit);
    return { success: true, data: logs };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// SETTINGS HANDLERS
ipcMain.handle('get-setting', (event, key) => {
  try {
    const value = db.getSetting(key);
    return { success: true, data: value };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-setting', (event, key, value) => {
  try {
    db.setSetting(key, value);
    return { success: true, message: 'Setting saved' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-all-settings', () => {
  try {
    const settings = db.getAllSettings();
    return { success: true, data: settings };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// SYNC LOG HANDLERS
ipcMain.handle('record-cloud-sync', (event, action, accountId, status, error, cloudProvider) => {
  try {
    db.recordCloudSync(action, accountId, status, error, cloudProvider);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-sync-logs', (event, limit = 50) => {
  try {
    const logs = db.getSyncLogs(limit);
    return { success: true, data: logs };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
