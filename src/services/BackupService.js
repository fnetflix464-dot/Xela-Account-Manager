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

export function deleteBackup(backupPath) {
  if (!FileService.pathExists(backupPath)) {
    throw new Error('Backup file not found');
  }
  FileService.deleteFile(backupPath);
}

/**
 * Renames a backup to a user-chosen label. The `vault-` prefix is always
 * enforced (not just cosmetic - listBackups() only discovers files that
 * start with it) and the label is sanitized to characters safe across
 * filesystems.
 */
export function renameBackup(backupPath, newLabel, backupDir) {
  if (!FileService.pathExists(backupPath)) {
    throw new Error('Backup file not found');
  }
  const sanitized = String(newLabel).trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 80);
  if (!sanitized) {
    throw new Error('Backup name cannot be empty');
  }
  const newPath = path.join(backupDir, `${BACKUP_PREFIX}${sanitized}${BACKUP_SUFFIX}`);
  if (newPath !== backupPath && FileService.pathExists(newPath)) {
    throw new Error('A backup with that name already exists');
  }
  FileService.renameFile(backupPath, newPath);
  return newPath;
}

export function exportBackupTo(backupPath, destPath) {
  if (!FileService.pathExists(backupPath)) {
    throw new Error('Backup file not found');
  }
  FileService.copyFile(backupPath, destPath);
}
