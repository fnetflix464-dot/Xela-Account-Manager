import fs from 'fs';
import path from 'path';

export const VAULT_FILE_VERSION = 1;

/**
 * Returns true if a path exists on disk.
 */
export function pathExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures a directory exists, creating it (and parents) if necessary.
 */
export function ensureDir(dirPath) {
  if (!pathExists(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Reads and parses the vault.xam file at filePath. The file itself is
 * plain JSON on the outside (salt + encrypted blob) - the *contents* of
 * the blob are what's actually encrypted.
 * @param {string} filePath
 * @returns {{ fileVersion: number, salt: string, iv: string, authTag: string, ciphertext: string }}
 */
export function readVaultFile(filePath) {
  if (!pathExists(filePath)) {
    throw new Error(`Vault file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Vault file is corrupted or not valid JSON');
  }
  if (!parsed.salt || !parsed.iv || !parsed.authTag || !parsed.ciphertext) {
    throw new Error('Vault file is missing required fields');
  }
  return parsed;
}

/**
 * Writes the vault envelope to disk atomically:
 *
 *   vault.tmp -> write -> fsync -> rename -> vault.xam
 *
 * The fsync is the step that actually matters for crash/power-loss
 * safety: `writeFileSync` alone only guarantees the data has been handed
 * to the OS, not that it has physically reached disk - without an
 * explicit fsync, a power loss between the write and the rename could
 * still leave the temp file (and thus a subsequent rename) holding
 * incomplete data. Renaming over the target is itself atomic at the
 * filesystem level (on both NTFS and POSIX filesystems), so once the
 * synced temp file is renamed, vault.xam is never observed in a
 * partially-written state - a crash either leaves the *previous*
 * vault.xam intact, or the *new*, fully-synced one; never a truncated
 * file in between.
 * @param {string} filePath
 * @param {{ salt: string, iv: string, authTag: string, ciphertext: string }} envelope
 */
export function writeVaultFile(filePath, envelope) {
  ensureDir(path.dirname(filePath));

  const payload = {
    fileVersion: VAULT_FILE_VERSION,
    salt: envelope.salt,
    iv: envelope.iv,
    authTag: envelope.authTag,
    ciphertext: envelope.ciphertext,
    savedAt: new Date().toISOString(),
  };

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tempPath, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(payload), 0, 'utf8');
    fs.fsyncSync(fd);
  } catch (err) {
    fs.closeSync(fd);
    deleteFile(tempPath);
    throw err;
  }
  fs.closeSync(fd);
  fs.renameSync(tempPath, filePath);
}

/**
 * Copies a file (used for backups and export). Overwrites destination.
 */
export function copyFile(sourcePath, destPath) {
  ensureDir(path.dirname(destPath));
  fs.copyFileSync(sourcePath, destPath);
}

/**
 * Lists files in a directory matching a prefix, sorted oldest-to-newest
 * by mtime. Returns absolute paths. Missing directory yields [].
 */
export function listFilesByPrefix(dirPath, prefix) {
  if (!pathExists(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.startsWith(prefix))
    .map((name) => path.join(dirPath, name))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
}

export function deleteFile(filePath) {
  if (pathExists(filePath)) {
    fs.unlinkSync(filePath);
  }
}
