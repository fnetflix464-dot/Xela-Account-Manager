import { createSettings } from './Settings.js';

export const VAULT_VERSION = 1;

/**
 * Creates an empty Vault. This is the root object that gets encrypted
 * and written to vault.xam in its entirety.
 * @param {Object} [overrides]
 */
export function createVault(overrides = {}) {
  const now = new Date().toISOString();
  return {
    version: VAULT_VERSION,
    createdAt: now,
    updatedAt: now,
    settings: overrides.settings || createSettings(),
    categories: Array.isArray(overrides.categories) ? overrides.categories : [],
    activityLog: Array.isArray(overrides.activityLog) ? overrides.activityLog : [],
    recycleBin: Array.isArray(overrides.recycleBin) ? overrides.recycleBin : [],
  };
}

export function touchVault(vault) {
  return { ...vault, updatedAt: new Date().toISOString() };
}

export function isVaultValid(vault) {
  return (
    !!vault &&
    typeof vault.version === 'number' &&
    !!vault.settings &&
    Array.isArray(vault.categories) &&
    Array.isArray(vault.activityLog) &&
    Array.isArray(vault.recycleBin)
  );
}
