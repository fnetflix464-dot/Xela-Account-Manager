/**
 * Resolves a theme preference ('light' | 'dark' | 'system' | undefined)
 * to an actual 'light' | 'dark' value, falling back to the OS preference
 * for 'system' (or when no preference is known yet - e.g. pre-login,
 * since the real preference lives inside the encrypted vault's settings
 * and isn't readable until unlocked).
 */
export function resolveTheme(themePreference) {
  if (themePreference === 'dark' || themePreference === 'light') return themePreference;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies the resolved theme to the document root as `data-theme`, which
 * every stylesheet's `:root[data-theme="dark"]` overrides key off.
 */
export function applyTheme(themePreference) {
  document.documentElement.setAttribute('data-theme', resolveTheme(themePreference));
}
