import * as CryptoService from '../services/CryptoService.js';
import * as FileService from '../services/FileService.js';
import * as BackupService from '../services/BackupService.js';

/**
 * VaultRepository is the only place in the app that touches disk or
 * encryption directly. VaultService hands it a plain in-memory vault
 * object and gets back / provides `{ vault, sessionKey, salt }` triples -
 * it never has to know that a vault is "really" a JSON envelope encrypted
 * with AES-256-GCM and backed up on every save.
 */

export function exists(vaultFilePath) {
  return FileService.pathExists(vaultFilePath);
}

/**
 * True if the vault file at vaultFilePath is at least well-formed (valid
 * JSON, has the expected envelope fields) - answerable without a
 * password. See FileService.isVaultFileStructurallyValid for why this is
 * deliberately a different question from "is the password correct".
 */
export function isStructurallyValid(vaultFilePath) {
  return FileService.isVaultFileStructurallyValid(vaultFilePath);
}

/**
 * Derives a brand-new key/salt pair for a master password (used both for
 * first-time vault creation and for a master-password change).
 */
export function deriveNewKey(masterPassword) {
  const salt = CryptoService.generateSalt();
  const sessionKey = CryptoService.deriveKey(masterPassword, salt);
  return { sessionKey, salt };
}

/**
 * Verifies a candidate password against the currently-active session key,
 * without touching disk.
 */
export function verifyKey(candidatePassword, salt, sessionKey) {
  const candidateKey = CryptoService.deriveKey(candidatePassword, salt);
  return Buffer.compare(candidateKey, sessionKey) === 0;
}

/**
 * Persists a vault object to disk: rotates a backup of whatever was there
 * before, then encrypts + atomically writes the new state.
 */
export function save(vaultFilePath, backupDir, vault, sessionKey, salt) {
  BackupService.createBackup(vaultFilePath, backupDir, vault.settings.backupCount);
  const envelope = CryptoService.encryptObject(vault, sessionKey);
  FileService.writeVaultFile(vaultFilePath, {
    salt: salt.toString('base64'),
    ...envelope,
  });
}

/**
 * Creates the on-disk vault file for a brand-new vault. Caller is
 * responsible for building the initial (empty) vault object.
 */
export function create(vaultFilePath, backupDir, masterPassword, vault) {
  const { sessionKey, salt } = deriveNewKey(masterPassword);
  save(vaultFilePath, backupDir, vault, sessionKey, salt);
  return { sessionKey, salt };
}

/**
 * Reads + decrypts the vault file at vaultFilePath. Throws if the
 * password is wrong or the file is missing/corrupted.
 */
export function load(vaultFilePath, masterPassword) {
  const envelope = FileService.readVaultFile(vaultFilePath);
  const salt = Buffer.from(envelope.salt, 'base64');
  const sessionKey = CryptoService.deriveKey(masterPassword, salt);
  const vault = CryptoService.decryptObject(envelope, sessionKey); // throws if wrong password
  return { vault, sessionKey, salt };
}

/**
 * Copies the live vault file to destPath (export). Assumes the caller has
 * already persisted the latest in-memory state.
 */
export function exportTo(vaultFilePath, destPath) {
  FileService.copyFile(vaultFilePath, destPath);
}

/**
 * Reads + decrypts an external vault file (import candidate) without
 * touching the live vault file. Throws if the password is wrong.
 */
export function importFrom(sourcePath, password) {
  const envelope = FileService.readVaultFile(sourcePath);
  const salt = Buffer.from(envelope.salt, 'base64');
  const sessionKey = CryptoService.deriveKey(password, salt);
  const vault = CryptoService.decryptObject(envelope, sessionKey); // throws if wrong password
  return { vault, sessionKey, salt };
}

/**
 * Replaces the live vault file with sourcePath (backing up the current
 * live file first, if any).
 */
export function replaceLiveFile(sourcePath, vaultFilePath, backupDir, keepCount) {
  if (exists(vaultFilePath)) {
    BackupService.createBackup(vaultFilePath, backupDir, keepCount);
  }
  FileService.copyFile(sourcePath, vaultFilePath);
}

export function listBackups(backupDir) {
  return BackupService.listBackups(backupDir);
}

export function restoreBackup(backupPath, vaultFilePath, backupDir, keepCount) {
  BackupService.restoreBackup(backupPath, vaultFilePath, backupDir, keepCount);
}

export function deleteBackup(backupPath) {
  BackupService.deleteBackup(backupPath);
}

export function renameBackup(backupPath, newLabel, backupDir) {
  return BackupService.renameBackup(backupPath, newLabel, backupDir);
}

export function exportBackupTo(backupPath, destPath) {
  BackupService.exportBackupTo(backupPath, destPath);
}
