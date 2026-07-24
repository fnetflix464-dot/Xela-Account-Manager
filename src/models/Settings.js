const THEMES = Object.freeze(['light', 'dark', 'system']);

const DEFAULT_PASSWORD_GENERATOR_SETTINGS = Object.freeze({
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
});

/**
 * Creates a Settings object with sensible defaults. Settings live inside
 * the Vault and are persisted with everything else.
 * @param {Object} [overrides]
 */
function createSettings(overrides = {}) {
  return {
    theme: THEMES.includes(overrides.theme) ? overrides.theme : 'system',
    autoLockMinutes:
      typeof overrides.autoLockMinutes === 'number' ? overrides.autoLockMinutes : 5,
    backupCount: typeof overrides.backupCount === 'number' ? overrides.backupCount : 10,
    passwordGenerator: {
      ...DEFAULT_PASSWORD_GENERATOR_SETTINGS,
      ...(overrides.passwordGenerator || {}),
    },
    recentFileLimit:
      typeof overrides.recentFileLimit === 'number' ? overrides.recentFileLimit : 10,
  };
}

function updateSettings(settings, updates = {}) {
  return {
    ...settings,
    ...updates,
    passwordGenerator: {
      ...settings.passwordGenerator,
      ...(updates.passwordGenerator || {}),
    },
  };
}

module.exports = {
  THEMES,
  DEFAULT_PASSWORD_GENERATOR_SETTINGS,
  createSettings,
  updateSettings,
};
