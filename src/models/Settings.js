export const THEMES = Object.freeze(['light', 'dark', 'system']);

export const DEFAULT_PASSWORD_GENERATOR_SETTINGS = Object.freeze({
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
export function createSettings(overrides = {}) {
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
    // 0 disables auto-clear. Default of 20s balances usability (enough
    // time to paste) against a copied password lingering indefinitely.
    clipboardClearSeconds:
      typeof overrides.clipboardClearSeconds === 'number' ? overrides.clipboardClearSeconds : 20,
    // 0 disables history entirely (no past values retained).
    passwordHistoryLimit:
      typeof overrides.passwordHistoryLimit === 'number' ? overrides.passwordHistoryLimit : 20,
    // null means "use the theme's built-in accent color" - a custom
    // accent is an override on top of the light/dark palette, not a
    // replacement for it.
    accentColor: typeof overrides.accentColor === 'string' ? overrides.accentColor : null,
  };
}

export function updateSettings(settings, updates = {}) {
  return {
    ...settings,
    ...updates,
    passwordGenerator: {
      ...settings.passwordGenerator,
      ...(updates.passwordGenerator || {}),
    },
  };
}
