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

function shade(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((num >> 16) & 0xff) + amount);
  const g = clamp(((num >> 8) & 0xff) + amount);
  const b = clamp((num & 0xff) + amount);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * Overrides the theme's built-in accent color (--color-primary and its
 * derivatives) via inline styles on the root element, which take
 * precedence over both the light and dark stylesheet palettes. Passing a
 * falsy value reverts to whatever the active theme's own accent is.
 */
export function applyAccentColor(accentColor) {
  const root = document.documentElement.style;
  if (accentColor) {
    root.setProperty('--color-primary', accentColor);
    root.setProperty('--color-primary-hover', shade(accentColor, -25));
    root.setProperty('--color-active-bg', `${accentColor}1f`);
  } else {
    root.removeProperty('--color-primary');
    root.removeProperty('--color-primary-hover');
    root.removeProperty('--color-active-bg');
  }
}
