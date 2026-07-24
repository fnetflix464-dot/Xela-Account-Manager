import { THEMES, createSettings as buildDefaultSettings, updateSettings as applyUpdate } from '../models/Settings.js';

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;
const MIN_BACKUP_COUNT = 1;
const MAX_BACKUP_COUNT = 100;

/**
 * Validates a fully-resolved Settings object, throwing a clear Error on
 * the first violation found. Mirrors the bounds already enforced by the
 * Settings UI's own input `min`/`max` attributes, plus the "at least one
 * character set" rule `passwordGenerator.js` already enforces at
 * generation time - now also enforced at save time so the UI surfaces the
 * problem immediately instead of only when a password is later generated.
 * @param {Object} settings
 */
export function validate(settings) {
  if (!THEMES.includes(settings.theme)) {
    throw new Error(`Invalid theme: ${settings.theme}`);
  }
  if (typeof settings.autoLockMinutes !== 'number' || Number.isNaN(settings.autoLockMinutes) || settings.autoLockMinutes < 0) {
    throw new Error('Auto-lock minutes must be zero (disabled) or greater');
  }
  if (
    !Number.isInteger(settings.backupCount) ||
    settings.backupCount < MIN_BACKUP_COUNT ||
    settings.backupCount > MAX_BACKUP_COUNT
  ) {
    throw new Error(`Backup count must be an integer between ${MIN_BACKUP_COUNT} and ${MAX_BACKUP_COUNT}`);
  }
  if (typeof settings.recentFileLimit !== 'number' || settings.recentFileLimit < 1) {
    throw new Error('Recent file limit must be at least 1');
  }

  const pg = settings.passwordGenerator || {};
  if (
    !Number.isInteger(pg.length) ||
    pg.length < MIN_PASSWORD_LENGTH ||
    pg.length > MAX_PASSWORD_LENGTH
  ) {
    throw new Error(
      `Password generator length must be an integer between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH}`,
    );
  }
  if (!pg.uppercase && !pg.lowercase && !pg.numbers && !pg.symbols) {
    throw new Error('At least one password generator character set must be enabled');
  }

  if (typeof settings.clipboardClearSeconds !== 'undefined') {
    if (typeof settings.clipboardClearSeconds !== 'number' || settings.clipboardClearSeconds < 0) {
      throw new Error('Clipboard auto-clear seconds must be zero (disabled) or greater');
    }
  }
  if (typeof settings.passwordHistoryLimit !== 'undefined') {
    if (!Number.isInteger(settings.passwordHistoryLimit) || settings.passwordHistoryLimit < 0) {
      throw new Error('Password history limit must be zero (disabled) or greater');
    }
  }
}

/**
 * Creates a default Settings object (already valid by construction).
 */
export function createDefault(overrides) {
  return buildDefaultSettings(overrides);
}

/**
 * Merges `updates` into `currentSettings` and validates the result before
 * returning it. Throws (without mutating anything) if the merged result
 * would be invalid.
 */
export function update(currentSettings, updates) {
  const next = applyUpdate(currentSettings, updates);
  validate(next);
  return next;
}
