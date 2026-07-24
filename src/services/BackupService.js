import path from 'path';
import * as FileService from './FileService.js';

export const BACKUP_PREFIX = 'vault-';
const BACKUP_SUFFIX = '.xam.bak';

function backupFileName(timestamp = new Date()) {
  const iso = timestamp.toISOString().replace(/[:.]/g, '-');
  return `${BACKUP_PREFIX}${iso}${BACKUP_SUFFIX}`;
}

/**
 * Creates a timestamped backup copy of the current vault file, then prunes
 * older backups beyond `keepCount`. Safe to call on every save.
 * @param {string} vaultFilePath path to the live vault.xam
 * @param {string} backupDir directory to store backups in
 * @param {number} keepCount how many backups to retain (default 10)
 * @returns {string|null} path of the backup created, or null if there was
 *   nothing to back up yet (first-ever save).
 */
export function createBackup(vaultFilePath, backupDir, keepCount = 10) {
  if (!FileService.pathExists(vaultFilePath)) {
    return null;
  }

  FileService.ensureDir(backupDir);
  const backupPath = path.join(backupDir, backupFileName());
  FileService.copyFile(vaultFilePath, backupPath);

  pruneBackups(backupDir, keepCount);
  return backupPath;
}

/**
 * Deletes the oldest backups beyond keepCount.
 */
export function pruneBackups(backupDir, keepCount) {
  const backups = FileService.listFilesByPrefix(backupDir, BACKUP_PREFIX);
  const excess = backups.length - Math.max(0, keepCount);
  for (let i = 0; i < excess; i += 1) {
    FileService.deleteFile(backups[i]);
  }
}

/**
 * Lists available backups, newest first.
 */
export function listBackups(backupDir) {
  return FileService.listFilesByPrefix(backupDir, BACKUP_PREFIX).reverse();
}

/**
 * Restores a backup file over the live vault file (also backs up the
 * current live file first, so a bad restore is itself reversible).
 */
export function restoreBackup(backupPath, vaultFilePath, backupDir, keepCount = 10) {
  if (!FileService.pathExists(backupPath)) {
    throw new Error('Backup file not found');
  }
  createBackup(vaultFilePath, backupDir, keepCount);
  FileService.copyFile(backupPath, vaultFilePath);
}
