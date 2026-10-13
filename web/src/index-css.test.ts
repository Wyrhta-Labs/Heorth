import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8');

const TOKENS = [
  'ground', 'surface', 'surface-2', 'surface-3', 'line', 'line-strong', 'fg', 'muted', 'faint',
  'primary', 'primary-hover', 'primary-light', 'primary-border', 'on-primary',
  ...['success', 'warning', 'danger', 'info', 'accent'].flatMap((s) => [s, `${s}-bg`, `${s}-border`]),
  'nav', 'nav-fg', 'nav-muted', 'nav-hover', 'nav-active', 'backdrop',
];

function block(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('index.css tokens', () => {
  it('declares every Slate token in @theme', () => {
    const theme = block('@theme static {');
    for (const t of TOKENS) expect(theme, t).toContain(`--color-${t}:`);
    expect(theme).toContain('--radius-card: 8px');
    expect(theme).toContain('--radius-control: 5px');
  });

  it('gives Hearth its own value for every token', () => {
    const hearth = block(":root[data-theme='hearth'] {");
    for (const t of TOKENS) expect(hearth, t).toContain(`--color-${t}:`);
  });

  it('keeps the old names as aliases onto the new tokens', () => {
    const theme = block('@theme static {');
    expect(theme).toContain('--color-card: var(--color-surface)');
    expect(theme).toContain('--color-ember: var(--color-primary)');
    expect(theme).toContain('--color-ink: var(--color-fg)');
  });

  it('Slate follows a dark device; Hearth stays light', () => {
    const dark = block("@media (prefers-color-scheme: dark) {");
    expect(dark).toContain(":root:not([data-theme='hearth'])");
    for (const t of TOKENS) expect(dark, t).toContain(`--color-${t}:`);
    expect(dark).toContain('color-scheme: dark');
  });

  it('never changes the root font size', () => {
    expect(css).not.toMatch(/html\s*\{[^}]*font-size/);
  });
});
