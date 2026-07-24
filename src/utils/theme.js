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

/**
 * Overrides the theme's base app background (--color-bg-app) - the outer
 * shell behind the sidebar/header/cards, same element a custom
 * background image applies to. Deliberately leaves --color-bg-surface
 * (cards, sidebar, header) alone, same reasoning as index.css's own
 * "only chrome backgrounds/text/borders are themed, not every surface"
 * design: a custom base color is a background choice, not a full skin.
 */
export function applyBackgroundColor(backgroundColor) {
  const root = document.documentElement.style;
  if (backgroundColor) {
    root.setProperty('--color-bg-app', backgroundColor);
  } else {
    root.removeProperty('--color-bg-app');
  }
}

function hexToRgba(hex, alpha) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const PANEL_OPACITY = 0.88;

/**
 * Makes cards/sidebar/header (--color-bg-surface, --color-bg-surface-alt)
 * a little translucent instead of fully opaque, so a custom background
 * image/color is actually visible behind the UI rather than fully hidden
 * behind it. Only takes effect when `active` is true (a custom background
 * is actually set) - reads the theme's own current color first via
 * getComputedStyle so this works correctly under both light and dark
 * (and doesn't need to know either palette's values itself), then applies
 * an alpha version of exactly that color as an inline override.
 */
export function applyPanelTranslucency(active) {
  const root = document.documentElement;
  if (!active) {
    root.style.removeProperty('--color-bg-surface');
    root.style.removeProperty('--color-bg-surface-alt');
    return;
  }
  const computed = getComputedStyle(root);
  const surface = computed.getPropertyValue('--color-bg-surface').trim();
  const surfaceAlt = computed.getPropertyValue('--color-bg-surface-alt').trim();
  if (surface.startsWith('#')) root.style.setProperty('--color-bg-surface', hexToRgba(surface, PANEL_OPACITY));
  if (surfaceAlt.startsWith('#')) {
    root.style.setProperty('--color-bg-surface-alt', hexToRgba(surfaceAlt, PANEL_OPACITY));
  }
}
