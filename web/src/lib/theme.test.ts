import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, readStoredTheme, THEME_STORAGE_KEY } from './theme';

const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')]
  .map((m) => [m.getAttribute('media'), m.getAttribute('content')]);

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#2563eb" />' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0e13" />';
  });

  it('slate sets data-theme, a light and a dark chrome colour, and is remembered', () => {
    applyTheme('slate');
    expect(document.documentElement.dataset['theme']).toBe('slate');
    expect(metas()).toEqual([
      ['(prefers-color-scheme: light)', '#2563eb'],
      ['(prefers-color-scheme: dark)', '#0b0e13'],
    ]);
    expect(readStoredTheme()).toBe('slate');
  });

  it('hearth writes the same warm colour to both metas', () => {
    applyTheme('hearth');
    expect(document.documentElement.dataset['theme']).toBe('hearth');
    expect(metas().map(([, c]) => c)).toEqual(['#b5542f', '#b5542f']);
  });

  it('falls back to slate for an unknown or missing value', () => {
    expect(readStoredTheme()).toBe('slate');
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readStoredTheme()).toBe('slate');
    applyTheme('neon');
    expect(document.documentElement.dataset['theme']).toBe('slate');
  });
});
