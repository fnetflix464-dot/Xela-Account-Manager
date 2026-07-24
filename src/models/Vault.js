const { createSettings } = require('./Settings');

const VAULT_VERSION = 1;

/**
 * Creates an empty Vault. This is the root object that gets encrypted
 * and written to vault.xam in its entirety.
 * @param {Object} [overrides]
 */
function createVault(overrides = {}) {
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

function touchVault(vault) {
  return { ...vault, updatedAt: new Date().toISOString() };
}

/**
 * Appends an activity log entry (capped at 500 most-recent entries so the
 * vault file doesn't grow unbounded).
 */
function logActivity(vault, action, details = {}) {
  const entry = {
    id: require('crypto').randomUUID(),
    action,
    details,
    timestamp: new Date().toISOString(),
  };
  const activityLog = [entry, ...vault.activityLog].slice(0, 500);
  return { ...vault, activityLog };
}

function isVaultValid(vault) {
  return (
    !!vault &&
    typeof vault.version === 'number' &&
    !!vault.settings &&
    Array.isArray(vault.categories) &&
    Array.isArray(vault.activityLog) &&
    Array.isArray(vault.recycleBin)
  );
}

module.exports = {
  VAULT_VERSION,
  createVault,
  touchVault,
  logActivity,
  isVaultValid,
};
