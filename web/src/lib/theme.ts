/**
 * Household-wide UI theme. The value comes from `household.theme` (server-side
 * list in src/household/options.ts); each one is a `data-theme` block in
 * index.css. The last applied theme is kept in localStorage only so the login
 * screen and the first paint after a reload already wear the household's look —
 * the household row stays the truth and overwrites it once loaded.
 */
export type ThemeName = 'slate' | 'hearth';

export const DEFAULT_THEME: ThemeName = 'slate';
export const THEME_STORAGE_KEY = 'heorth.theme';

/** Browser chrome colour per theme, for a light and a dark device. A <meta>
 *  cannot read a CSS variable, so these are literals. Hearth is light only. */
const THEME_COLORS: Record<ThemeName, { light: string; dark: string }> = {
  slate: { light: '#2563eb', dark: '#0b0e13' },
  hearth: { light: '#b5542f', dark: '#b5542f' },
};

function toTheme(value: string | null | undefined): ThemeName {
  return value != null && value in THEME_COLORS ? (value as ThemeName) : DEFAULT_THEME;
}

export function readStoredTheme(): ThemeName {
  try {
    return toTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(value: string | null | undefined): void {
  const theme = toTheme(value);
  document.documentElement.dataset['theme'] = theme;
  const colors = THEME_COLORS[theme];
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const dark = meta.getAttribute('media')?.includes('dark') ?? false;
    meta.setAttribute('content', dark ? colors.dark : colors.light);
  });
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the household query still applies it.
  }
}
