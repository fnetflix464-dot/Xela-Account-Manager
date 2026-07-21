const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods to React
contextBridge.exposeInMainWorld('electron', {
  // Master Password
  setMasterPassword: (password) => ipcRenderer.invoke('set-master-password', password),
  verifyMasterPassword: (password) => ipcRenderer.invoke('verify-master-password', password),
  checkMasterPasswordExists: () => ipcRenderer.invoke('check-master-password-exists'),

  // Accounts
  addAccount: (account) => ipcRenderer.invoke('add-account', account),
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  getAccount: (id) => ipcRenderer.invoke('get-account', id),
  updateAccount: (id, account) => ipcRenderer.invoke('update-account', id, account),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),

  // Password Strength
  validatePasswordStrength: (password) => ipcRenderer.invoke('validate-password-strength', password),

  // 2FA
  enable2FA: (accountId, method, backupCodes) => ipcRenderer.invoke('enable-2fa', accountId, method, backupCodes),
  disable2FA: (accountId) => ipcRenderer.invoke('disable-2fa', accountId),
  get2FAStatus: (accountId) => ipcRenderer.invoke('get-2fa-status', accountId),

  // Backups
  createBackup: () => ipcRenderer.invoke('create-backup'),
  createAutoBackup: () => ipcRenderer.invoke('create-auto-backup'),
  restoreBackup: (backupData) => ipcRenderer.invoke('restore-backup', backupData),
  getBackupHistory: (limit) => ipcRenderer.invoke('get-backup-history', limit),

  // Security
  getSecurityStats: () => ipcRenderer.invoke('get-security-stats'),
  getAuditLog: (limit) => ipcRenderer.invoke('get-audit-log', limit),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  getAllSettings: () => ipcRenderer.invoke('get-all-settings'),

  // Sync
  recordCloudSync: (action, accountId, status, error, provider) =>
    ipcRenderer.invoke('record-cloud-sync', action, accountId, status, error, provider),
  getSyncLogs: (limit) => ipcRenderer.invoke('get-sync-logs', limit),
});
