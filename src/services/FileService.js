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
 * Writes the vault envelope to disk atomically: writes to a temp file in
 * the same directory, then renames over the target. This avoids leaving
 * a truncated/corrupted vault.xam if the process dies mid-write.
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
  fs.writeFileSync(tempPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
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
