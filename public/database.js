const Database = require('better-sqlite3');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ENCRYPTION_KEY_LENGTH = 32;
const SALT_ROUNDS = 10;

class AccountDatabase {
  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'accounts.db');
    this.db = new Database(this.dbPath);
    this.masterPasswordHash = null;
    this.encryptionKey = null;
    this.initDatabase();
  }

  initDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        email TEXT,
        password TEXT NOT NULL,
        notes TEXT,
        twoFactorEnabled INTEGER DEFAULT 0,
        twoFactorMethod TEXT,
        twoFactorBackupCodes TEXT,
        passwordStrength TEXT,
        lastPasswordChange DATETIME,
        passwordExpiryDays INTEGER,
        lastLogin DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        cloudProvider TEXT,
        cloudPath TEXT,
        fileSize INTEGER,
        accountCount INTEGER,
        encryptionKey TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        uploadedAt DATETIME,
        isAutoBackup INTEGER DEFAULT 0,
        backupType TEXT DEFAULT 'manual'
      );

      CREATE TABLE IF NOT EXISTS sync_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        accountId TEXT,
        status TEXT,
        errorMessage TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        cloudProvider TEXT
      );

      CREATE TABLE IF NOT EXISTS security_audit (
        id TEXT PRIMARY KEY,
        eventType TEXT NOT NULL,
        accountId TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS password_history (
        id TEXT PRIMARY KEY,
        accountId TEXT NOT NULL,
        oldPassword TEXT NOT NULL,
        changedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  setMasterPassword(password) {
    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run('masterPasswordHash', hash);
    this.masterPasswordHash = hash;
    this.generateEncryptionKey(password);
  }

  verifyMasterPassword(password) {
    if (!this.masterPasswordHash) {
      const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
      const result = stmt.get('masterPasswordHash');
      if (!result) return false;
      this.masterPasswordHash = result.value;
    }
    const isValid = bcrypt.compareSync(password, this.masterPasswordHash);
    if (isValid) {
      this.generateEncryptionKey(password);
    }
    return isValid;
  }

  generateEncryptionKey(password) {
    this.encryptionKey = crypto
      .pbkdf2Sync(password, 'salt', 100000, ENCRYPTION_KEY_LENGTH, 'sha256');
  }

  encrypt(text) {
    if (!this.encryptionKey) {
      throw new Error('Master password not set. Please authenticate first.');
    }
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  decrypt(encryptedText) {
    if (!this.encryptionKey) {
      throw new Error('Master password not set. Please authenticate first.');
    }
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  calculatePasswordStrength(password) {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;

    const levels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
    return levels[Math.min(strength, 5)];
  }

  addAccount(account) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    const encryptedPassword = this.encrypt(account.password);
    const passwordStrength = this.calculatePasswordStrength(account.password);

    const stmt = this.db.prepare(`
      INSERT INTO accounts (
        id, category, platform, username, email, password, notes,
        twoFactorEnabled, twoFactorMethod, passwordStrength, lastPasswordChange
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      id,
      account.category,
      account.platform,
      account.username,
      account.email || null,
      encryptedPassword,
      account.notes || null,
      account.twoFactorEnabled ? 1 : 0,
      account.twoFactorMethod || null,
      passwordStrength
    );

    this.logSecurityEvent('ACCOUNT_CREATED', id, `New account added for ${account.platform}`);

    return { id, ...account, password: '[encrypted]', passwordStrength };
  }

  getAccounts() {
    const stmt = this.db.prepare('SELECT * FROM accounts ORDER BY category, platform');
    const accounts = stmt.all();
    return accounts.map(acc => ({
      ...acc,
      password: '[encrypted]',
      twoFactorEnabled: Boolean(acc.twoFactorEnabled),
    }));
  }

  getAccount(id) {
    const stmt = this.db.prepare('SELECT * FROM accounts WHERE id = ?');
    const account = stmt.get(id);
    if (account) {
      account.password = this.decrypt(account.password);
      account.twoFactorEnabled = Boolean(account.twoFactorEnabled);
      if (account.twoFactorBackupCodes) {
        account.twoFactorBackupCodes = JSON.parse(account.twoFactorBackupCodes);
      }
    }
    return account;
  }

  updateAccount(id, account) {
    const currentAccount = this.getAccount(id);
    const encryptedPassword = account.password === '[encrypted]' 
      ? currentAccount.password 
      : this.encrypt(account.password);

    if (account.password && account.password !== '[encrypted]') {
      this.storePasswordHistory(id, currentAccount.password);
    }

    const passwordStrength = account.password && account.password !== '[encrypted]'
      ? this.calculatePasswordStrength(account.password)
      : currentAccount.passwordStrength;

    const stmt = this.db.prepare(`
      UPDATE accounts
      SET category = ?, platform = ?, username = ?, email = ?, password = ?,
          notes = ?, twoFactorEnabled = ?, twoFactorMethod = ?,
          twoFactorBackupCodes = ?, passwordStrength = ?,
          lastPasswordChange = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE lastPasswordChange END,
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const passwordChanged = account.password && account.password !== '[encrypted]';

    stmt.run(
      account.category,
      account.platform,
      account.username,
      account.email || null,
      encryptedPassword,
      account.notes || null,
      account.twoFactorEnabled ? 1 : 0,
      account.twoFactorMethod || null,
      account.twoFactorBackupCodes ? JSON.stringify(account.twoFactorBackupCodes) : null,
      passwordStrength,
      passwordChanged ? 1 : 0,
      id
    );

    this.logSecurityEvent('ACCOUNT_UPDATED', id, `Account updated for ${account.platform}`);

    return { id, ...account, password: '[encrypted]', passwordStrength };
  }

  deleteAccount(id) {
    const stmt = this.db.prepare('DELETE FROM accounts WHERE id = ?');
    stmt.run(id);
    this.logSecurityEvent('ACCOUNT_DELETED', id, 'Account deleted');
    return { success: true };
  }

  enable2FA(accountId, method, backupCodes) {
    const stmt = this.db.prepare(`
      UPDATE accounts
      SET twoFactorEnabled = 1, twoFactorMethod = ?, twoFactorBackupCodes = ?
      WHERE id = ?
    `);

    stmt.run(method, JSON.stringify(backupCodes), accountId);
    this.logSecurityEvent('2FA_ENABLED', accountId, `2FA enabled via ${method}`);
    return { success: true };
  }

  disable2FA(accountId) {
    const stmt = this.db.prepare(`
      UPDATE accounts
      SET twoFactorEnabled = 0, twoFactorMethod = NULL, twoFactorBackupCodes = NULL
      WHERE id = ?
    `);

    stmt.run(accountId);
    this.logSecurityEvent('2FA_DISABLED', accountId, '2FA disabled');
    return { success: true };
  }

  get2FAStatus(accountId) {
    const stmt = this.db.prepare(`
      SELECT twoFactorEnabled, twoFactorMethod, twoFactorBackupCodes
      FROM accounts WHERE id = ?
    `);
    const result = stmt.get(accountId);
    if (result) {
      return {
        enabled: Boolean(result.twoFactorEnabled),
        method: result.twoFactorMethod,
        backupCodesCount: result.twoFactorBackupCodes 
          ? JSON.parse(result.twoFactorBackupCodes).length 
          : 0,
      };
    }
    return null;
  }

  storePasswordHistory(accountId, oldPassword) {
    const { v4: uuidv4 } = require('uuid');
    const stmt = this.db.prepare(`
      INSERT INTO password_history (id, accountId, oldPassword)
      VALUES (?, ?, ?)
    `);
    stmt.run(uuidv4(), accountId, oldPassword);
  }

  getPasswordHistory(accountId, limit = 5) {
    const stmt = this.db.prepare(`
      SELECT oldPassword, changedAt FROM password_history
      WHERE accountId = ? ORDER BY changedAt DESC LIMIT ?
    `);
    return stmt.all(accountId, limit).map(entry => ({
      ...entry,
      oldPassword: '[encrypted]',
    }));
  }

  logSecurityEvent(eventType, accountId, details) {
    const { v4: uuidv4 } = require('uuid');
    const stmt = this.db.prepare(`
      INSERT INTO security_audit (id, eventType, accountId, details)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(uuidv4(), eventType, accountId, details);
  }

  getAuditLog(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM security_audit ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(limit);
  }

  createBackup() {
    const { v4: uuidv4 } = require('uuid');
    const accounts = this.getAccounts();
    const backupId = uuidv4();
    const timestamp = new Date().toISOString();
    const filename = `backup_${timestamp.replace(/[:.]/g, '-')}.json`;

    const backupData = {
      version: '1.0',
      timestamp,
      accounts,
    };

    const backupJson = JSON.stringify(backupData, null, 2);
    const fileSize = Buffer.byteLength(backupJson, 'utf8');

    const stmt = this.db.prepare(`
      INSERT INTO backups (
        id, filename, fileSize, accountCount, createdAt, backupType
      )
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `);

    stmt.run(backupId, filename, fileSize, accounts.length, 'manual');

    return {
      id: backupId,
      filename,
      data: backupJson,
      fileSize,
      accountCount: accounts.length,
    };
  }

  createAutoBackup() {
    const backup = this.createBackup();
    
    const stmt = this.db.prepare(`
      UPDATE backups SET isAutoBackup = 1 WHERE id = ?
    `);
    stmt.run(backup.id);

    return backup;
  }

  restoreBackup(backupData) {
    try {
      const data = JSON.parse(backupData);
      
      if (data.version !== '1.0') {
        throw new Error('Unsupported backup version');
      }

      if (!Array.isArray(data.accounts)) {
        throw new Error('Invalid backup format');
      }

      this.logSecurityEvent('BACKUP_RESTORE_STARTED', null, `Restoring ${data.accounts.length} accounts`);

      data.accounts.forEach(account => {
        const existingAccount = this.db.prepare('SELECT id FROM accounts WHERE id = ?').get(account.id);
        
        if (existingAccount) {
          const stmt = this.db.prepare(`
            UPDATE accounts
            SET category = ?, platform = ?, username = ?, email = ?, password = ?,
                notes = ?, twoFactorEnabled = ?, twoFactorMethod = ?,
                twoFactorBackupCodes = ?, passwordStrength = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?
          `);
          
          stmt.run(
            account.category,
            account.platform,
            account.username,
            account.email,
            account.password,
            account.notes,
            account.twoFactorEnabled ? 1 : 0,
            account.twoFactorMethod,
            account.twoFactorBackupCodes,
            account.passwordStrength,
            account.id
          );
        } else {
          const stmt = this.db.prepare(`
            INSERT INTO accounts (
              id, category, platform, username, email, password, notes,
              twoFactorEnabled, twoFactorMethod, twoFactorBackupCodes, passwordStrength
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          
          stmt.run(
            account.id,
            account.category,
            account.platform,
            account.username,
            account.email,
            account.password,
            account.notes,
            account.twoFactorEnabled ? 1 : 0,
            account.twoFactorMethod,
            account.twoFactorBackupCodes,
            account.passwordStrength
          );
        }
      });

      this.logSecurityEvent('BACKUP_RESTORE_COMPLETED', null, `Successfully restored ${data.accounts.length} accounts`);

      return {
        success: true,
        accountsRestored: data.accounts.length,
      };
    } catch (error) {
      this.logSecurityEvent('BACKUP_RESTORE_FAILED', null, `Error: ${error.message}`);
      throw error;
    }
  }

  getBackupHistory(limit = 10) {
    const stmt = this.db.prepare(`
      SELECT id, filename, fileSize, accountCount, createdAt, uploadedAt, isAutoBackup, backupType, cloudProvider
      FROM backups ORDER BY createdAt DESC LIMIT ?
    `);
    return stmt.all(limit);
  }

  recordCloudSync(action, accountId, status, error, cloudProvider) {
    const { v4: uuidv4 } = require('uuid');
    const stmt = this.db.prepare(`
      INSERT INTO sync_logs (id, action, accountId, status, errorMessage, cloudProvider)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(uuidv4(), action, accountId, status, error || null, cloudProvider);
  }

  getSyncLogs(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_logs ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(limit);
  }

  getSecurityStats() {
    const totalAccounts = this.db.prepare('SELECT COUNT(*) as count FROM accounts').get().count;
    const accountsWith2FA = this.db.prepare('SELECT COUNT(*) as count FROM accounts WHERE twoFactorEnabled = 1').get().count;
    const weakPasswords = this.db.prepare("SELECT COUNT(*) as count FROM accounts WHERE passwordStrength IN ('Very Weak', 'Weak')").get().count;
    
    const oldPasswords = this.db.prepare(`
      SELECT COUNT(*) as count FROM accounts 
      WHERE datetime(lastPasswordChange) < datetime('now', '-90 days')
    `).get().count;

    const recentEvents = this.getAuditLog(10);

    return {
      totalAccounts,
      accountsWith2FA,
      twoFAPercentage: totalAccounts > 0 ? Math.round((accountsWith2FA / totalAccounts) * 100) : 0,
      weakPasswords,
      passwordsOlderThan90Days: oldPasswords,
      recentEvents,
    };
  }

  getSetting(key) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get(key);
    return result ? result.value : null;
  }

  setSetting(key, value) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(key, value);
    return { success: true };
  }

  getAllSettings() {
    const stmt = this.db.prepare('SELECT key, value FROM settings');
    return stmt.all();
  }
}

module.exports = AccountDatabase;
