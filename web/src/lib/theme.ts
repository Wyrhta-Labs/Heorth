/**
 * Household-wide UI theme. The value comes from `household.theme` (server-side
 * list in src/household/options.ts); each one is a `data-theme` block in
 * index.css. The last applied theme is kept in localStorage only so the login
 * screen and the first paint after a reload already wear the household's look —
 * the household row stays the truth and overwrites it once loaded.
 */
export type ThemeName = 'hearth' | 'slate';

export const DEFAULT_THEME: ThemeName = 'hearth';
export const THEME_STORAGE_KEY = 'heorth.theme';

/** Browser chrome colour (`<meta name="theme-color">`) per theme: its primary. */
const THEME_COLORS: Record<ThemeName, string> = {
  hearth: '#b5542f',
  slate: '#2563eb',
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the household query still applies it.
  }
}
