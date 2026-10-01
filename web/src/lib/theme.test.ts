import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, readStoredTheme, THEME_STORAGE_KEY } from './theme';

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    document.head.innerHTML = '<meta name="theme-color" content="#b5542f" />';
  });

  it('sets data-theme, the browser theme colour and remembers the choice', () => {
    applyTheme('slate');
    expect(document.documentElement.dataset['theme']).toBe('slate');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#2563eb');
    expect(readStoredTheme()).toBe('slate');

    applyTheme('hearth');
    expect(document.documentElement.dataset['theme']).toBe('hearth');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#b5542f');
  });

  it('falls back to hearth for an unknown value, stored or applied', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readStoredTheme()).toBe('hearth');
    applyTheme('neon');
    expect(document.documentElement.dataset['theme']).toBe('hearth');
  });
});
