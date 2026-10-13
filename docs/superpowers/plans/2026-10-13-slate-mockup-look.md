# Slate Mockup Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Heorth's web UI takes the Jaguar mockup's look — shell, buttons, cards, chips, icon treatment, device-following dark mode — as the `slate` theme, and `slate` becomes the default.

**Architecture:** One component tree. `web/src/index.css` declares the mockup's tokens in Tailwind v4's `@theme` (Slate light owns `:root`), Hearth redefines them under `:root[data-theme='hearth']`, and Slate dark redefines them under a `prefers-color-scheme: dark` media query added last. The `ui/` primitives and the shell are restyled onto those tokens; old token names stay as aliases. Four nav count badges come from one hook that reuses the pages' query keys.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), class-variance-authority, lucide-react, TanStack Router + Query, react-i18next, Vitest + Testing Library (jsdom). Server: Hono, Drizzle, PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-13-slate-mockup-look-design.md`
**Visual reference:** `~/projects/wus-technik/decision-platform/mockup-jaguar-app.html` — its `<style>` block (lines 3–537) is the source of every pixel value below.

## Global Constraints

- Work in the `Heorth` repo on branch `feat/slate-mockup-look`. Follow `Heorth/AGENTS.md`.
- Server tests need a Postgres database whose name ends in `_test` (`DATABASE_URL`), never a dev database. Web tests run with `cd web && npx vitest run <path>`.
- Root font size stays 16px. Only `body` is 13.5px. Never change `html { font-size }`.
- Variant names of `Button` and `Badge` are kept; variants are restyled and new ones added. No call site changes for a rename.
- Lucide icons only. No new icon dependency, no Font Awesome glyphs.
- Hearth stays selectable and light-only. It is not verified pixel by pixel.
- Every `t()` key added goes into **both** `web/src/i18n/locales/en.json` and `de.json`.
- Commit messages in English, no AI co-author trailer, ending with the `Claude-Session:` line the session supplies.
- Mobile breakpoint stays Tailwind's `md` (768px); the rail starts below 1100px (`max-[1100px]:` arbitrary variant).
- Never derive a date from `toISOString()`; the household's today is `todayInTimeZone(household.timezone)` from `web/src/lib/format.ts`.

### Token names (Tailwind utility ← mockup variable)

Tailwind turns `--color-x` into `bg-x` / `text-x` / `border-x`, so some mockup names are renamed to read well as utilities. **Use exactly these names in every task.**

| Tailwind token | Utility example | Mockup variable |
|---|---|---|
| `--color-ground` | `bg-ground` | `--bg` |
| `--color-surface`, `--color-surface-2`, `--color-surface-3` | `bg-surface-2` | same |
| `--color-line`, `--color-line-strong` | `border-line-strong` | `--border`, `--border-strong` |
| `--color-fg` | `text-fg` | `--text` |
| `--color-muted` | `text-muted` | `--text-muted` |
| `--color-faint` | `text-faint` | `--text-light` |
| `--color-primary`, `-hover`, `-light`, `-border`, `--color-on-primary` | `bg-primary-light` | same |
| `--color-{success,warning,danger,info,accent}`, each `-bg`, `-border` | `bg-danger-bg` | same |
| `--color-nav`, `--color-nav-fg`, `--color-nav-muted`, `--color-nav-hover`, `--color-nav-active` | `bg-nav` | `--nav-bg` … |
| `--color-backdrop` | `bg-backdrop` | `--backdrop` |
| `--radius-card` (8px), `--radius-control` (5px) | `rounded-card` | `--radius`, `--radius-sm` |
| `--shadow-card`, `--shadow-pop` | `shadow-card` | `--shadow-sm`, `--shadow` |

Aliases (old → new), kept so untouched pages keep working: `parchment→ground`, `card→surface`, `linen→surface-3`, `tan→line`, `ink→fg`, `ash→muted`, `ember→primary`, `ember-soft→primary-border`, `taupe→accent`, `sage→success`, `sky→info`, `amber→warning`. `danger` is a real token.

## Review Focus

1. **A household in a time zone ahead of UTC, a task due late evening** — the Tasks badge must count a task due 23:30 household time as today and one due 00:30 the next household day as not yet due (Task 9).
2. **A Weorc chore completed from the Weorc page or the start page** — the Weorc badge must drop without a reload; its query key sits under `['weorc','routines']` so the existing invalidations reach it (Task 9).
3. **A dialog opened on a long page** — the page behind must not scroll, now that `<main>` and not `body` is the scroller (Task 6).
4. **A server error on one badge source** — no toast, no error state, the other badges and the page unaffected; a 401 still logs out (Task 9).
5. **A narrow tablet (800–1100px)** — the rail must show icons with badges and a `title` per item, and never the group headings (Task 7).

---

### Task 1: Server default theme is `slate`

**Files:**
- Modify: `src/household/options.ts` (themes list, `DEFAULT_THEME`)
- Modify: `src/household/schema.ts` (column default)
- Create: generated migration `src/db/migrations/0031_appearance_default_slate.sql` + snapshot (via drizzle-kit)
- Test: `tests/household-routes.test.ts:90-122`

**Interfaces:**
- Produces: `GET /api/v1/household` returns `theme: 'slate'` for a household without an appearance row; options list `['slate', 'hearth']`.

- [ ] **Step 1: Update the tests first**

In `tests/household-routes.test.ts`, replace the two theme tests' expectations:

```ts
  it('serves the slate theme by default and the theme list in the options', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/household', { headers: authHeaders(child.jwt) });
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { theme: string } }).data.theme).toBe('slate');

    const opts = await app.request('/api/v1/household/options', { headers: authHeaders(child.jwt) });
    const { data } = await opts.json() as { data: { themes: { value: string; label: string }[] } };
    expect(data.themes.map((t) => t.value)).toEqual(['slate', 'hearth']);
  });
```

In the second test (`only an admin can switch the household theme…`) switch every `'slate'` to `'hearth'` — the PATCH must now prove a move *away* from the default persists: `patch(adult.jwt, { theme: 'hearth' })` → 403, `patch(admin.jwt, { theme: 'hearth' })` → 200 with `theme: 'hearth'`, and the rename and re-read both still report `'hearth'`.

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/household-routes.test.ts -t theme`
Expected: FAIL — `expected 'hearth' to be 'slate'` and the options order.

- [ ] **Step 3: Implement**

`src/household/options.ts`:

```ts
/**
 * Household-wide UI themes. `slate` is the default for every household (the
 * cool, crisp look with a device-following dark mode); `hearth` is the warm
 * original, light only. The web app maps each value to its tokens in
 * web/src/index.css - adding one here requires a matching block there.
 */
export const SUPPORTED_THEMES: readonly LocaleOption[] = Object.freeze([
  { value: 'slate', label: 'Slate' },
  { value: 'hearth', label: 'Hearth' },
]);

export const DEFAULT_THEME = 'slate';
```

`src/household/schema.ts`: `theme: text('theme').notNull().default('slate'),`

Generate the migration: `npm run db:generate -- --name appearance_default_slate`. Check the generated SQL is exactly `ALTER TABLE "household_appearance" ALTER COLUMN "theme" SET DEFAULT 'slate';` (an existing row is not touched).

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/household-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/household tests/household-routes.test.ts src/db/migrations
git commit -m "feat: slate is the household's default theme"
```

---

### Task 2: Web default theme, browser chrome colours, manifest

**Files:**
- Modify: `web/src/lib/theme.ts`
- Modify: `web/index.html:11`
- Modify: `web/public/manifest.webmanifest:10-11`
- Test: `web/src/lib/theme.test.ts`

**Interfaces:**
- Produces: `type ThemeName = 'slate' | 'hearth'`, `DEFAULT_THEME = 'slate'`, `applyTheme()` writes both `meta[name="theme-color"]` tags.

- [ ] **Step 1: Write the failing test** — replace `web/src/lib/theme.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, expect failure**

Run: `cd web && npx vitest run src/lib/theme.test.ts` — FAIL (default is hearth, one meta).

- [ ] **Step 3: Implement** `web/src/lib/theme.ts`:

```ts
/**
 * Household-wide UI theme. The value comes from `household.theme` (server-side
 * list in src/household/options.ts); each one is a token block in index.css.
 * The last applied theme is kept in localStorage only so the login screen and
 * the first paint after a reload already wear the household's look - the
 * household row stays the truth and overwrites it once loaded.
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
```

`web/index.html` line 11 becomes two lines:

```html
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#2563eb" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0e13" />
```

`web/public/manifest.webmanifest`: `"background_color": "#f0f2f5",` and `"theme_color": "#2563eb",`.

- [ ] **Step 4: Run** `cd web && npx vitest run src/lib/theme.test.ts src/hooks/use-i18n.test.tsx src/components/household` — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/theme.ts web/src/lib/theme.test.ts web/index.html web/public/manifest.webmanifest
git commit -m "feat(web): slate is the default theme; chrome colour follows light and dark"
```

---

### Task 3: Token foundation in `index.css`

**Files:**
- Modify: `web/src/index.css` (whole file)
- Create: `web/src/index-css.test.ts`

**Interfaces:**
- Produces: every token in the Global Constraints table, the aliases, `--heading-weight`, `--heading-tracking`, the `zebra` utility. Slate dark is **not** added here (Task 14).

- [ ] **Step 1: Write the failing contract test** `web/src/index-css.test.ts`:

```ts
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
    const theme = block('@theme {');
    for (const t of TOKENS) expect(theme, t).toContain(`--color-${t}:`);
    expect(theme).toContain('--radius-card: 8px');
    expect(theme).toContain('--radius-control: 5px');
  });

  it('gives Hearth its own value for every token', () => {
    const hearth = block(":root[data-theme='hearth'] {");
    for (const t of TOKENS) expect(hearth, t).toContain(`--color-${t}:`);
  });

  it('keeps the old names as aliases onto the new tokens', () => {
    const theme = block('@theme {');
    expect(theme).toContain('--color-card: var(--color-surface)');
    expect(theme).toContain('--color-ember: var(--color-primary)');
    expect(theme).toContain('--color-ink: var(--color-fg)');
  });

  it('never changes the root font size', () => {
    expect(css).not.toMatch(/html\s*\{[^}]*font-size/);
  });
});
```

- [ ] **Step 2: Run** `cd web && npx vitest run src/index-css.test.ts` — FAIL.

- [ ] **Step 3: Rewrite `web/src/index.css`** (the drift animation at the end is unchanged):

```css
@import "tailwindcss";

/*
 * Theme tokens. Slate (household.theme 'slate', the default) owns :root and is
 * declared here; Hearth redefines the same tokens under [data-theme='hearth']
 * below; Slate's dark palette follows the device (added with the colour sweep).
 * Values for Slate are the Jaguar mockup's (decision-platform/mockup-jaguar-app.html).
 */
@theme {
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-serif: var(--font-sans);
  --font-mono: ui-monospace, 'Cascadia Mono', Consolas, 'SFMono-Regular', monospace;

  --color-ground: #f0f2f5;
  --color-surface: #ffffff;
  --color-surface-2: #f8f9fb;
  --color-surface-3: #eef1f5;
  --color-line: #e2e6ea;
  --color-line-strong: #cdd2d8;
  --color-fg: #1a1d23;
  --color-muted: #6b7380;
  --color-faint: #9aa0ab;

  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-light: #eff4ff;
  --color-primary-border: #bfdbfe;
  --color-on-primary: #ffffff;

  --color-success: #16a34a; --color-success-bg: #f0fdf4; --color-success-border: #bbf7d0;
  --color-danger: #dc2626;  --color-danger-bg: #fff5f5;  --color-danger-border: #fecaca;
  --color-warning: #b45309; --color-warning-bg: #fffbeb; --color-warning-border: #fde68a;
  --color-accent: #7c3aed;  --color-accent-bg: #f3effe;  --color-accent-border: #e3d8fd;
  --color-info: #0369a1;    --color-info-bg: #f0f9ff;    --color-info-border: #bae6fd;

  --color-nav: #161b24;
  --color-nav-fg: #e7eaf0;
  --color-nav-muted: #8b93a3;
  --color-nav-hover: #222935;
  --color-nav-active: #2b3444;

  --color-backdrop: rgb(15 18 24 / 0.45);

  --radius-card: 8px;
  --radius-control: 5px;
  --shadow-card: 0 1px 3px rgb(0 0 0 / 0.07), 0 1px 2px rgb(0 0 0 / 0.05);
  --shadow-pop: 0 8px 28px rgb(0 0 0 / 0.14);
  --shadow-sm: 0 1px 3px rgb(0 0 0 / 0.07), 0 1px 2px rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);

  /* Old names, kept as aliases so pages not yet moved keep working. */
  --color-parchment: var(--color-ground);
  --color-card: var(--color-surface);
  --color-linen: var(--color-surface-3);
  --color-tan: var(--color-line);
  --color-ink: var(--color-fg);
  --color-ash: var(--color-muted);
  --color-ember: var(--color-primary);
  --color-ember-soft: var(--color-primary-border);
  --color-taupe: var(--color-accent);
  --color-sage: var(--color-success);
  --color-sky: var(--color-info);
  --color-amber: var(--color-warning);
}

:root {
  --heading-weight: 700;
  --heading-tracking: -0.02em;
  --body-size: 13.5px;
}

/* Hearth: the warm original. Light only; same tokens, warm values. */
:root[data-theme='hearth'] {
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-serif: 'Fraunces', ui-serif, Georgia, 'Times New Roman', serif;

  --color-ground: #f3eee2;
  --color-surface: #faf7f0;
  --color-surface-2: #f5f0e6;
  --color-surface-3: #e9e1d1;
  --color-line: #ddd3c2;
  --color-line-strong: #c9bca6;
  --color-fg: #2b2823;
  --color-muted: #7d756a;
  --color-faint: #a39a8c;

  --color-primary: #b5542f;
  --color-primary-hover: #9c4626;
  --color-primary-light: #f6e6dd;
  --color-primary-border: #d98a68;
  --color-on-primary: #ffffff;

  --color-success: #5f7155; --color-success-bg: #eef1ea; --color-success-border: #cfd8c8;
  --color-danger: #c0392b;  --color-danger-bg: #f9e9e7;  --color-danger-border: #ecc1bb;
  --color-warning: #a07535; --color-warning-bg: #f7efe1; --color-warning-border: #e6d3ae;
  --color-accent: #8a7c6a;  --color-accent-bg: #f1eee9;  --color-accent-border: #d9d1c4;
  --color-info: #6b7e8c;    --color-info-bg: #ebeff2;    --color-info-border: #c9d3db;

  --color-nav: #2b2823;
  --color-nav-fg: #f3eee2;
  --color-nav-muted: #a39a8c;
  --color-nav-hover: rgb(255 255 255 / 0.08);
  --color-nav-active: #b5542f;

  --color-backdrop: rgb(43 40 35 / 0.5);

  --heading-weight: 600;
  --heading-tracking: -0.01em;
  --body-size: 15px;
}

/* Odd/even rows for lists and tables: put `zebra` on the <ul>/<tbody> and
   every second row takes a light ground. Its selector outranks a row's
   own bg-surface, so rows keep their classes. */
@utility zebra {
  & > :nth-child(even) {
    background-color: color-mix(in srgb, var(--color-surface-3) 60%, var(--color-surface));
  }
}

* {
  box-sizing: border-box;
  border-color: var(--color-line);
}

body {
  margin: 0;
  background-color: var(--color-ground);
  color: var(--color-fg);
  font-family: var(--font-sans);
  font-size: var(--body-size);
  line-height: 1.5;
  font-feature-settings: "kern" 1, "liga" 1, "calt" 1;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 {
  font-family: var(--font-serif);
  font-weight: var(--heading-weight);
  letter-spacing: var(--heading-tracking);
}

:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
```

…followed by the unchanged `hearth-drift` keyframes, class and reduced-motion block.

Note: `--color-*` values declared in `@theme` are emitted on `:root`; the Hearth block has a higher specificity selector on the same element, so it wins. The aliases are declared on `:root` too and resolve from whichever `--color-surface` etc. applies.

- [ ] **Step 4: Run** `cd web && npx vitest run src/index-css.test.ts && npm run build` — test PASS, build succeeds.

- [ ] **Step 5: Run the full web suite** `cd web && npx vitest run` — PASS (no component changed yet).

- [ ] **Step 6: Commit**

```bash
git add web/src/index.css web/src/index-css.test.ts
git commit -m "feat(web): the mockup's token set, Slate on :root, Hearth as a data-theme block"
```

---

### Task 4: `Button` and `Badge`

**Files:**
- Modify: `web/src/components/ui/button.tsx`, `web/src/components/ui/badge.tsx`
- Create: `web/src/components/ui/button.test.tsx`, `web/src/components/ui/badge.test.tsx`

**Interfaces:**
- Produces: `Button` variants `default | outline | secondary | ghost | destructive | link | warning | success`, sizes `default | sm | lg | icon`. `Badge` variants `default | secondary | outline | success | warning | destructive | info | accent`.

- [ ] **Step 1: Write the failing tests**

`button.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button';

const cases = [
  ['default', 'bg-primary'],
  ['outline', 'border-line-strong'],
  ['secondary', 'bg-surface-3'],
  ['ghost', 'text-muted'],
  ['destructive', 'bg-danger-bg'],
  ['warning', 'bg-warning-bg'],
  ['success', 'bg-success'],
  ['link', 'text-primary'],
] as const;

describe('Button', () => {
  it.each(cases)('%s variant uses its token classes', (variant, cls) => {
    render(<Button variant={variant}>{variant}</Button>);
    expect(screen.getByRole('button', { name: variant })).toHaveClass(cls);
  });

  it('has the mockup shape: control radius, 1.5px border, weight 600', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('rounded-control', 'border-[1.5px]', 'font-semibold');
  });
});
```

`badge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge';

const cases = [
  ['default', 'bg-primary-light'],
  ['secondary', 'bg-surface-3'],
  ['outline', 'bg-surface-2'],
  ['success', 'bg-success-bg'],
  ['warning', 'bg-warning-bg'],
  ['destructive', 'bg-danger-bg'],
  ['info', 'bg-info-bg'],
  ['accent', 'bg-accent-bg'],
] as const;

describe('Badge', () => {
  it.each(cases)('%s variant uses its token classes', (variant, cls) => {
    render(<Badge variant={variant}>{variant}</Badge>);
    expect(screen.getByText(variant)).toHaveClass(cls, 'rounded-full');
  });
});
```

- [ ] **Step 2: Run** `cd web && npx vitest run src/components/ui/button.test.tsx src/components/ui/badge.test.tsx` — FAIL.

- [ ] **Step 3: Implement**

`button.tsx` (`ButtonProps` and the component body are unchanged):

```tsx
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control border-[1.5px] border-transparent text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-on-primary hover:bg-primary-hover',
        outline: 'border-line-strong bg-transparent text-muted hover:border-muted hover:bg-surface-2 hover:text-fg',
        secondary: 'bg-surface-3 text-fg hover:bg-line',
        ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
        destructive: 'bg-danger-bg border-danger-border text-danger hover:border-danger',
        warning: 'bg-warning-bg border-warning-border text-warning hover:border-warning',
        success: 'bg-success text-on-primary hover:brightness-95',
        link: 'border-0 px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-[30px] px-[11px] text-xs',
        lg: 'h-10 px-6',
        icon: 'h-9 w-9 [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
```

`badge.tsx`:

```tsx
const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-semibold',
  {
    variants: {
      variant: {
        default: 'bg-primary-light text-primary border-primary-border',
        secondary: 'bg-surface-3 text-fg border-transparent',
        outline: 'bg-surface-2 text-muted border-line',
        success: 'bg-success-bg text-success border-success-border',
        warning: 'bg-warning-bg text-warning border-warning-border',
        destructive: 'bg-danger-bg text-danger border-danger-border',
        info: 'bg-info-bg text-info border-info-border',
        accent: 'bg-accent-bg text-accent border-accent-border',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
```

- [ ] **Step 4: Run** the two tests, then `cd web && npx vitest run && npx tsc -b --noEmit` — PASS. If an existing test asserts an old class (e.g. `bg-ember`), update the assertion to the new class; do not change behaviour assertions.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui/button.tsx web/src/components/ui/badge.tsx web/src/components/ui/*.test.tsx
git commit -m "feat(web): mockup buttons and chips; variants restyled, warning/success/info/accent added"
```

---

### Task 5: `Card` and section tones

**Files:**
- Modify: `web/src/components/ui/card.tsx`, `web/src/components/ui/section-tone.tsx`
- Create: `web/src/components/ui/section-tone.test.tsx`

**Interfaces:**
- Consumes: tokens (Task 3).
- Produces: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` (same exports); `SectionTitle`, `SectionCard`, `toneCard`, `shadeFor`, `Tone`, `Shade` (same signatures).

- [ ] **Step 1: Write the failing test** `section-tone.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Wallet } from 'lucide-react';
import { SectionCard } from './section-tone';

describe('SectionCard', () => {
  it('renders the icon in a 24px tinted square in the tone colour', () => {
    render(<SectionCard title="Bills" icon={Wallet} tone="amber">x</SectionCard>);
    const square = screen.getByText('Bills').parentElement!.querySelector('[data-slot="section-icon"]')!;
    expect(square).toHaveClass('size-6', 'rounded-md', 'bg-warning-bg', 'text-warning');
  });

  it('header is a strip with a bottom border', () => {
    render(<SectionCard title="Bills" icon={Wallet} tone="ember">x</SectionCard>);
    const header = screen.getByText('Bills').closest('[data-slot="card-header"]')!;
    expect(header).toHaveClass('border-b');
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`card.tsx` — replace the class strings and add `data-slot`:

```tsx
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="card" className={cn('overflow-hidden rounded-card border border-line bg-surface shadow-card', className)} {...props} />
  )
);
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="card-header" className={cn('flex flex-col gap-1 border-b border-line bg-surface-2 px-4 py-2.5', className)} {...props} />
  )
);
const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-[13px] font-bold leading-snug text-fg', className)} {...props} />
  )
);
const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-[11px] text-muted', className)} {...props} />
  )
);
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-4 py-3.5', className)} {...props} />
  )
);
const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-2 border-t border-line bg-surface-2 px-4 py-3', className)} {...props} />
  )
);
```

(keep each `displayName` line and the export line.)

Callers that passed `className="pb-3"` or `pt-0`/`p-6` overrides to `CardHeader`/`CardContent` keep working via `cn`; a caller's `p-6` now overrides the new padding — acceptable, tidied in the sweep when seen.

`section-tone.tsx` — keep `tint`, `shades`, `shadeFor`, `toneCard` but switch the token names inside them (`--color-ember` → `--color-primary`, `--color-sky` → `--color-info`, `--color-amber` → `--color-warning`, `--color-sage` → `--color-success`, `--color-taupe` → `--color-accent`, `--color-card` → `--color-surface`; `border-ember/20` → `border-primary/20`, etc.). Replace `iconColor` and the two components:

```tsx
/** The 24px icon square of a section header: the tone's light ground, its colour. */
const iconSquare: Record<Tone, string> = {
  ember: 'bg-primary-light text-primary',
  sky: 'bg-info-bg text-info',
  amber: 'bg-warning-bg text-warning',
  sage: 'bg-success-bg text-success',
  taupe: 'bg-accent-bg text-accent',
};

/** A card headline led by its icon in a small tinted square (the mockup's .card-ic). */
export function SectionTitle({ icon: Icon, tone, className, children }: {
  icon: LucideIcon;
  tone: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <CardTitle className={cn('flex items-center gap-2', className)}>
      <span data-slot="section-icon" className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', iconSquare[tone])}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      {children}
    </CardTitle>
  );
}

/** A headed card in one accent: icon headline, tinted (or shaded) ground. On a
 *  toned card the header strip takes the tint instead of surface-2. */
export function SectionCard({ title, icon, tone, shade, children }: {
  title: string;
  icon: LucideIcon;
  tone: Tone;
  shade?: Shade;
  children: ReactNode;
}) {
  return (
    <Card className={toneCard(tone, shade)}>
      <CardHeader className="bg-transparent"><SectionTitle icon={icon} tone={tone}>{title}</SectionTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run** `cd web && npx vitest run && npx tsc -b --noEmit` — PASS (update class-name-only assertions if any).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui/card.tsx web/src/components/ui/section-tone.tsx web/src/components/ui/section-tone.test.tsx
git commit -m "feat(web): mockup cards: header strip and tinted icon square"
```

---

### Task 6: Form, table, dialog, toast, tabs, progress, label, avatar

**Files:**
- Modify: `web/src/components/ui/{input,textarea,table,dialog,toast,tabs,progress,label,member-avatar}.tsx`
- Create: `web/src/components/ui/dialog.test.tsx`

**Interfaces:**
- Produces: `SCROLL_ROOT_ATTR = 'data-scroll-root'` exported from `dialog.tsx`; Task 8 puts it on `<main>`. Every other export unchanged.

- [ ] **Step 1: Write the failing test** `dialog.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Dialog, DialogContent, SCROLL_ROOT_ATTR } from './dialog';

function Page({ open }: { open: boolean }) {
  return (
    <main {...{ [SCROLL_ROOT_ATTR]: '' }} data-testid="main">
      <Dialog open={open} onOpenChange={() => {}}><DialogContent>hi</DialogContent></Dialog>
    </main>
  );
}

describe('Dialog scroll lock', () => {
  it('locks body and the shell scroller while open, and releases both', () => {
    const { rerender, getByTestId } = render(<Page open />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(getByTestId('main').style.overflow).toBe('hidden');
    rerender(<Page open={false} />);
    expect(document.body.style.overflow).toBe('');
    expect(getByTestId('main').style.overflow).toBe('');
  });

  it('uses the backdrop token', () => {
    render(<Page open />);
    expect(document.querySelector('.bg-backdrop')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run** — FAIL (`SCROLL_ROOT_ATTR` not exported).

- [ ] **Step 3: Implement**

`dialog.tsx`:

```tsx
/** Marks the element that scrolls the page (the shell's <main>), so an open
 *  dialog can lock it as well as <body>. */
export const SCROLL_ROOT_ATTR = 'data-scroll-root';

function Dialog({ open, onOpenChange, children, className }: DialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const targets = [document.body, ...document.querySelectorAll<HTMLElement>(`[${SCROLL_ROOT_ATTR}]`)];
    targets.forEach((el) => { el.style.overflow = 'hidden'; });
    return () => targets.forEach((el) => { el.style.overflow = ''; });
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-backdrop" onClick={() => onOpenChange(false)} />
      <div className={cn('relative z-50 w-full max-w-lg', className)}>{children}</div>
    </div>
  );
}
```

Remove `SCROLL_ROOT_ATTR` from the final `export { … }` list only if duplicated — it is exported at declaration. Class changes in the same file:
- `DialogContent`: `'relative max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[10px] border border-line bg-surface p-[18px] shadow-pop'`
- `DialogTitle`: `'text-base font-bold text-fg'`
- `DialogDescription`: `'text-[13px] text-muted'`
- `DialogFooter`: `'-mx-[18px] -mb-[18px] mt-4 flex justify-end gap-2 rounded-b-[10px] border-t border-line bg-surface-2 px-[18px] py-3'`
- `DialogClose`: `'absolute right-4 top-4 rounded-sm text-faint hover:text-fg'`

`input.tsx` classes: `'flex h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[13.5px] text-fg transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-faint focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-primary-border disabled:cursor-not-allowed disabled:opacity-50'`

`textarea.tsx` classes: `'flex min-h-[72px] w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[13.5px] leading-[1.45] text-fg placeholder:text-faint focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-primary-border disabled:cursor-not-allowed disabled:opacity-50'`

`table.tsx`:
- wrapper `div`: `'w-full overflow-auto rounded-control border border-line'`
- `Table`: `'w-full caption-bottom border-collapse text-[12.5px] tabular-nums'`
- `TableRow`: `'border-b border-line transition-colors hover:bg-surface-2 data-[state=selected]:bg-surface-3'`
- `TableHead`: `'h-auto whitespace-nowrap border-b-[1.5px] border-line bg-surface-2 px-2.5 py-[7px] text-left align-middle text-[10px] font-bold uppercase tracking-[0.4px] text-muted [&:has([role=checkbox])]:pr-0'`
- `TableCell`: `'px-2.5 py-2 align-middle [&:has([role=checkbox])]:pr-0'`

`tabs.tsx` (the mockup's `.seg`):
- `TabsList`: `'inline-flex flex-wrap items-stretch overflow-hidden rounded-[7px] border border-line-strong'`
- `TabsTrigger` base: `'inline-flex items-center justify-center whitespace-nowrap border-l border-line-strong px-3.5 py-[7px] text-[12.5px] font-semibold first:border-l-0 transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50'`; active `'bg-primary-light text-primary'`, inactive `'bg-surface text-muted hover:text-fg'`.
- `TabsContent`: `'mt-3 focus-visible:outline-2 focus-visible:outline-primary'`

`toast.tsx` — the toast container: `'fixed bottom-[calc(22px+env(safe-area-inset-bottom,0px))] left-1/2 z-[60] flex w-[min(460px,calc(100%-32px))] -translate-x-1/2 flex-col gap-2'`; each toast: `'flex items-center gap-3 rounded-lg bg-fg px-3.5 py-2.5 text-[13px] text-surface shadow-pop'` (drop the per-variant backgrounds); icons: success `text-success-border`, error `text-danger-border`, info `text-primary-border`; message span `'flex-1'`; close button `'text-surface/70 hover:text-surface'`.

`progress.tsx`: default `color = 'var(--color-primary)'`; track `'h-[5px] w-full overflow-hidden rounded-full bg-line'`.

`label.tsx`: replace its one gray class with `text-fg` and set `text-xs font-semibold`.

`member-avatar.tsx`: keep `text-white` (text on a member's data colour; allowlisted in Task 11).

- [ ] **Step 4: Run** `cd web && npx vitest run && npx tsc -b --noEmit` — PASS (fix class-only assertions).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui
git commit -m "feat(web): mockup forms, tables, dialogs, toasts and segmented tabs; dialogs lock the shell scroller"
```

---

### Task 7: Grouped sidebar with rail and user footer

**Files:**
- Modify: `web/src/components/layout/sidebar.tsx`
- Modify: `web/src/components/layout/sidebar.test.tsx`
- Modify: `web/src/i18n/locales/en.json`, `de.json` (`nav` object)

**Interfaces:**
- Consumes: `useWhoami()` (`@/hooks/use-household`), `useAuth().logout` (`@/hooks/use-auth`), `MemberAvatar`.
- Produces:
  - `type NavGroup = 'day' | 'household' | 'system'`
  - `type NavCountKey = 'tasks' | 'shopping' | 'weorc' | 'feoh'`
  - `NavItem` gains `group: NavGroup` and `count?: NavCountKey`
  - `navGroups(items: NavItem[]): Array<{ group: NavGroup; items: NavItem[] }>`
  - `type NavCounts = Partial<Record<NavCountKey, number | undefined>>`
  - `<NavBadge count={number | undefined} />` exported — renders nothing for `undefined` or `0`.
  - `Sidebar` accepts `counts?: NavCounts` (Task 10 passes it).

- [ ] **Step 1: Write the failing tests** — add to `sidebar.test.tsx` (keep the four existing tests; replace `activeLabel` to read `aria-current`):

```tsx
vi.mock('@/hooks/use-household', () => ({
  useWhoami: () => ({ data: { data: { displayName: 'Ana', avatarColor: 'sky', role: 'adult' } } }),
}));
const logoutMock = vi.fn();
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ logout: logoutMock }) }));

function activeLabel(): string | undefined {
  return document.querySelector('aside a[aria-current="page"]')?.textContent?.trim();
}
```

`renderAt` takes `counts` and renders `<Sidebar counts={counts} />`. New tests:

```tsx
  it('groups the items under Day, Household and System', async () => {
    renderAt();
    await screen.findByText('This week');
    const groups = [...document.querySelectorAll('aside [data-nav-group]')].map((g) => [
      g.getAttribute('data-nav-group'),
      [...g.querySelectorAll('a')].map((a) => a.textContent?.trim()),
    ]);
    expect(groups).toEqual([
      ['day', ['This week', 'Today', 'Calendar', 'Tasks', 'Shopping list', 'Quick capture', 'Meals']],
      ['household', ['Feoh', 'Ethel', 'Weorc', 'Library']],
      ['system', ['Household', 'Hearth (wall)']],
    ]);
  });

  it('appends KithLedger to System only', async () => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: true, kithledger: true, kithledgerUrl: 'http://kith.test' } } });
    renderAt();
    const system = await screen.findByText('Hearth (wall)');
    expect(system.closest('[data-nav-group]')).toHaveAttribute('data-nav-group', 'system');
    expect(screen.getByRole('link', { name: /KithLedger/ }).closest('[data-nav-group]'))
      .toHaveAttribute('data-nav-group', 'system');
  });

  it('shows a badge above zero only, with an accessible label', async () => {
    renderAt('/', { tasks: 3, shopping: 0, weorc: undefined, feoh: 12 });
    await screen.findByText('Tasks');
    expect(screen.getByLabelText('3 open')).toBeInTheDocument();
    expect(screen.getByLabelText('12 open')).toBeInTheDocument();
    expect(screen.queryByLabelText('0 open')).toBeNull();
    expect(document.querySelectorAll('aside [data-nav-badge]')).toHaveLength(2);
  });

  it('gives every item a title for the icon rail', async () => {
    renderAt();
    expect(await screen.findByTitle('Weorc')).toBeInTheDocument();
  });

  it('shows the signed-in member in the footer, links to the profile and signs out', async () => {
    renderAt();
    const profile = await screen.findByRole('link', { name: /Ana/ });
    expect(profile).toHaveAttribute('href', '/profile');
    screen.getByRole('button', { name: 'Sign out' }).click();
    expect(logoutMock).toHaveBeenCalled();
  });
```

(Add `leaf('/profile')` to the test route tree.)

- [ ] **Step 2: Run** `cd web && npx vitest run src/components/layout/sidebar.test.tsx` — FAIL.

- [ ] **Step 3: Add i18n keys** — in `en.json`'s `nav` object:

```json
    "group": { "day": "Day", "household": "Household", "system": "System" },
    "countLabel": "{{count}} open"
```

and in `de.json`'s `nav` object:

```json
    "group": { "day": "Tag", "household": "Haushalt", "system": "System" },
    "countLabel": "{{count}} offen"
```

- [ ] **Step 4: Implement `sidebar.tsx`**

```tsx
import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, CalendarDays, ListChecks, UtensilsCrossed, Wallet, Home, Flame, Library,
  Sun, ShoppingCart, PlusCircle, Tv, Package, ClipboardList, BookUser, ExternalLink, LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFeatures } from '@/hooks/use-features';
import { useWhoami } from '@/hooks/use-household';
import { useAuth } from '@/hooks/use-auth';
import { MemberAvatar } from '@/components/ui/member-avatar';

export type NavLabelKey = /* unchanged union */;
export type NavGroup = 'day' | 'household' | 'system';
export type NavCountKey = 'tasks' | 'shopping' | 'weorc' | 'feoh';
export type NavCounts = Partial<Record<NavCountKey, number | undefined>>;

export interface NavItem {
  to: string;
  labelKey: NavLabelKey;
  icon: typeof LayoutDashboard;
  group: NavGroup;
  /** Which nav count badge this item shows, if any (hooks/use-nav-counts.ts). */
  count?: NavCountKey;
  exact?: boolean;
  activePrefix?: string;
  external?: boolean;
}

export function isNavItemActive(item: NavItem, pathname: string): boolean { /* unchanged */ }

export const navItems: NavItem[] = [
  { to: '/', labelKey: 'nav.thisWeek', icon: LayoutDashboard, group: 'day', exact: true },
  { to: '/today', labelKey: 'nav.today', icon: Sun, group: 'day' },
  { to: '/calendar', labelKey: 'nav.calendar', icon: CalendarDays, group: 'day' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: ListChecks, group: 'day', count: 'tasks' },
  { to: '/shopping', labelKey: 'nav.shoppingList', icon: ShoppingCart, group: 'day', count: 'shopping' },
  { to: '/capture', labelKey: 'nav.quickCapture', icon: PlusCircle, group: 'day' },
  { to: '/meals', labelKey: 'nav.meals', icon: UtensilsCrossed, group: 'day' },
  { to: '/feoh', labelKey: 'nav.feoh', icon: Wallet, group: 'household', count: 'feoh' },
  { to: '/ethel', labelKey: 'nav.ethel', icon: Package, group: 'household' },
  { to: '/weorc', labelKey: 'nav.weorc', icon: ClipboardList, group: 'household', count: 'weorc' },
  { to: '/library', labelKey: 'nav.library', icon: Library, group: 'household' },
  { to: '/household/members', labelKey: 'nav.household', icon: Home, group: 'system', activePrefix: '/household' },
  { to: '/hearth', labelKey: 'nav.hearth', icon: Tv, group: 'system' },
];

export function navItemsForFeatures(kithledgerUrl: string | null | undefined): NavItem[] {
  if (!kithledgerUrl) return navItems;
  return [...navItems, { to: kithledgerUrl, labelKey: 'nav.kithledger', icon: BookUser, group: 'system', external: true }];
}

const GROUP_ORDER: NavGroup[] = ['day', 'household', 'system'];

export function navGroups(items: NavItem[]): Array<{ group: NavGroup; items: NavItem[] }> {
  return GROUP_ORDER
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
}

/** A count pill; nothing for zero or an unknown count. */
export function NavBadge({ count, className }: { count: number | undefined; className?: string }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span
      data-nav-badge
      aria-label={t('nav.countLabel', { count })}
      className={cn('min-w-5 rounded-full bg-primary px-[7px] text-center text-[11px] font-bold tabular-nums text-on-primary', className)}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

const RAIL = 'max-[1100px]';

export default function Sidebar({ counts = {} }: { counts?: NavCounts }) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const features = useFeatures();
  const me = useWhoami().data?.data;
  const { logout } = useAuth();
  const groups = navGroups(navItemsForFeatures(features.data?.data.kithledgerUrl));

  return (
    <aside className={cn(
      'hidden md:flex h-dvh w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto bg-nav px-2.5 py-3.5 text-nav-fg',
      `${RAIL}:w-16`,
    )}>
      <div className={cn('flex items-center gap-2.5 px-2 pb-4 pt-1', `${RAIL}:justify-center ${RAIL}:px-0`)}>
        <span className="grid size-[30px] shrink-0 place-items-center rounded-card bg-primary text-on-primary">
          <Flame className="size-[17px]" aria-hidden="true" />
        </span>
        <span className={cn('text-base font-extrabold tracking-[-0.2px]', `${RAIL}:hidden`)}>Heorth</span>
      </div>
      <nav className="flex flex-col gap-0.5">
        {groups.map(({ group, items }) => (
          <div key={group} data-nav-group={group} className="flex flex-col gap-0.5">
            <div className={cn('px-2.5 pb-1 pt-3.5 text-[10.5px] font-bold uppercase tracking-[0.7px] text-nav-muted', `${RAIL}:hidden`)}>
              {t(`nav.group.${group}`)}
            </div>
            {items.map((item) => {
              const { to, labelKey, icon: Icon } = item;
              const active = !item.external && isNavItemActive(item, pathname);
              const label = t(labelKey);
              const count = item.count ? counts[item.count] : undefined;
              const className = cn(
                'relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left font-medium transition-colors hover:bg-nav-hover',
                active && 'bg-nav-active font-[650]',
                `${RAIL}:justify-center ${RAIL}:px-0 ${RAIL}:py-2.5`,
              );
              const body = (
                <>
                  <Icon className="size-[17px] shrink-0 opacity-85" aria-hidden="true" />
                  <span className={cn('flex-1', `${RAIL}:hidden`)}>{label}</span>
                  {item.external && <ExternalLink className={cn('size-3.5 shrink-0', `${RAIL}:hidden`)} aria-hidden="true" />}
                  <NavBadge count={count} className={cn(`${RAIL}:absolute ${RAIL}:right-1 ${RAIL}:top-0.5 ${RAIL}:min-w-4 ${RAIL}:px-[5px] ${RAIL}:text-[9.5px]`)} />
                </>
              );
              return item.external ? (
                <a key={to} href={to} target="_blank" rel="noreferrer" title={label} className={className}>{body}</a>
              ) : (
                <Link key={to} to={to} title={label} aria-current={active ? 'page' : undefined} className={className}>{body}</Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-h-3 flex-1" />
      <div className={cn('flex items-center gap-2.5 border-t border-nav-active px-2 pb-0.5 pt-2.5', `${RAIL}:flex-col ${RAIL}:px-0`)}>
        <Link to="/profile" className="flex min-w-0 flex-1 items-center gap-2.5" title={me?.displayName}>
          {me && <MemberAvatar name={me.displayName} color={me.avatarColor} size="sm" />}
          <span className={cn('min-w-0 text-[12.5px] leading-tight', `${RAIL}:hidden`)}>
            <span className="block truncate">{me?.displayName}</span>
            {me && <span className="block text-[11px] text-nav-muted">{t(`options.role.${me.role}`)}</span>}
          </span>
        </Link>
        <button type="button" onClick={logout} title={t('nav.signOut')} aria-label={t('nav.signOut')}
          className="grid size-8 shrink-0 place-items-center rounded-md text-nav-muted hover:bg-nav-hover hover:text-nav-fg">
          <LogOut className="size-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
```

Keep the `NavLabelKey` union exactly as it is today. The translation keys are typed, so template-literal keys do not type-check: replace `t(\`nav.group.${group}\`)` with `t(GROUP_KEYS[group])` and `t(\`options.role.${me.role}\`)` with `t(ROLE_KEYS[me.role])`, declared in `sidebar.tsx` as

```tsx
export const GROUP_KEYS = { day: 'nav.group.day', household: 'nav.group.household', system: 'nav.group.system' } as const;
const ROLE_KEYS = { admin: 'options.role.admin', adult: 'options.role.adult', child: 'options.role.child' } as const;
```

`GROUP_KEYS` is exported; Task 8's More sheet uses it.

- [ ] **Step 5: Run** `cd web && npx vitest run src/components/layout && npx tsc -b --noEmit` — PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/layout/sidebar.tsx web/src/components/layout/sidebar.test.tsx web/src/i18n/locales
git commit -m "feat(web): grouped navy sidebar with icon rail, count badges and member footer"
```

---

### Task 8: Top bar, mobile bottom bar, app shell scroll mechanics

**Files:**
- Modify: `web/src/components/layout/top-bar.tsx`, `mobile-nav.tsx`, `app-shell.tsx`
- Modify: `web/src/components/layout/mobile-nav.test.tsx`
- Create: `web/src/components/layout/app-shell.test.tsx`

**Interfaces:**
- Consumes: `SCROLL_ROOT_ATTR` (Task 6), `navGroups`, `NavBadge`, `NavCounts` (Task 7).
- Produces: `MobileNav` accepts `counts?: NavCounts`; `AppShell` renders `<main data-scroll-root>` and resets its `scrollTop` on route change. Task 10 wires counts.

- [ ] **Step 1: Write the failing test** `app-shell.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import AppShell from './app-shell';

vi.mock('@/hooks/use-features', () => ({ useFeatures: () => ({ data: { data: { kithledgerUrl: null } } }) }));
vi.mock('@/hooks/use-household', () => ({ useWhoami: () => ({ data: undefined }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ logout: vi.fn() }) }));

function renderShell() {
  const root = createRootRoute({ component: AppShell });
  const leaf = (p: string) => createRoute({ getParentRoute: () => root, path: p, component: () => <div>page {p}</div> });
  const router = createRouter({
    routeTree: root.addChildren([leaf('/'), leaf('/calendar')]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('AppShell', () => {
  it('scrolls inside <main>, marked as the scroll root, and resets it on navigation', async () => {
    const router = renderShell();
    const main = await screen.findByRole('main');
    expect(main).toHaveAttribute('data-scroll-root');
    expect(main).toHaveClass('overflow-y-auto', 'min-h-0');
    main.scrollTop = 400;
    await router.navigate({ to: '/calendar' });
    await screen.findByText('page /calendar');
    await waitFor(() => expect(main.scrollTop).toBe(0));
  });
});
```

The shell does not use `useNavCounts` yet (Task 10 adds it, together with its `vi.mock` in this test file).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`app-shell.tsx` (`PAGE_TITLES` and `titleKeyFor` unchanged):

```tsx
import { useEffect, useRef } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import Sidebar from './sidebar';
import TopBar from './top-bar';
import MobileNav from './mobile-nav';
import { ToastProvider } from '@/components/ui/toast';
import { SCROLL_ROOT_ATTR } from '@/components/ui/dialog';
// … PAGE_TITLES, titleKeyFor unchanged …

export default function AppShell() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const titleKey = titleKeyFor(pathname);
  const title = titleKey ? t(titleKey) : 'Heorth';
  const mainRef = useRef<HTMLElement>(null);

  // <main> is the page's scroller (the shell is viewport-high), so the
  // router's window scroll restoration does not reach it: start each page at the top.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    <ToastProvider>
      <div className="flex h-dvh overflow-hidden bg-ground">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TopBar title={title} />
          <main
            ref={mainRef}
            {...{ [SCROLL_ROOT_ATTR]: '' }}
            className="min-h-0 flex-1 overflow-y-auto p-3 pb-20 sm:p-5 md:pb-6"
          >
            <Outlet />
          </main>
        </div>
        <MobileNav />
      </div>
    </ToastProvider>
  );
}
```

`top-bar.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { useWhoami } from '@/hooks/use-household';

/** The page title. The member and sign-out live in the sidebar footer; on
 *  phone widths, where the sidebar is hidden, the avatar stays here. */
export default function TopBar({ title }: { title: string }) {
  const me = useWhoami().data?.data;
  return (
    <header className="z-[2] flex h-[52px] shrink-0 items-center gap-3.5 border-b border-line bg-surface px-4 shadow-card md:px-5">
      <h1 className="font-sans text-[15px] font-bold text-fg">{title}</h1>
      {me && (
        <Link to="/profile" className="ml-auto md:hidden" title={me.displayName}>
          <MemberAvatar name={me.displayName} color={me.avatarColor} size="sm" />
        </Link>
      )}
    </header>
  );
}
```

`mobile-nav.tsx` — signature `export default function MobileNav({ counts = {} }: { counts?: NavCounts })`. Changes:
- `TABS` gains `count`: `{ to: '/shopping', labelKey: 'nav.shoppingTab', icon: ShoppingCart, count: 'shopping' as const }` (others without).
- Bar: `'md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-nav-active bg-nav pb-[env(safe-area-inset-bottom,0px)]'`.
- Tab link: `'relative flex flex-1 flex-col items-center gap-px py-1.5 text-[10px] font-medium'`, active `'text-nav-fg'`, inactive `'text-nav-muted'`; icon `size-5`; after the label `{tab.count && <NavBadge count={counts[tab.count]} className="absolute right-[calc(50%-22px)] top-0.5 min-w-4 px-[5px] text-[9.5px]" />}`.
- More button same classes as an inactive tab.
- More sheet: replace the flat `navItems.map` with `navGroups(navItems).map(({ group, items }) => …)` rendering a heading `<div className="px-3 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[0.7px] text-muted">{t(GROUP_KEYS[group])}</div>` and the existing link markup per item, with link classes `'flex items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium text-fg hover:bg-surface-2'`, icon `text-muted`, and `<NavBadge count={item.count ? counts[item.count] : undefined} className="ml-auto" />` at the end. `GROUP_KEYS`, `navGroups`, `NavBadge` and `NavCounts` are imported from `./sidebar`.

Update `mobile-nav.test.tsx`: any assertion on `text-ember` for the active tab becomes `text-nav-fg`; add

```tsx
  it('shows the shopping count on the Shopping tab', async () => {
    renderMobileNav({ shopping: 4 });   // extend the file's render helper to pass counts
    expect(await screen.findByLabelText('4 open')).toBeInTheDocument();
  });
```

- [ ] **Step 4: Run** `cd web && npx vitest run src/components/layout && npx tsc -b --noEmit` — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/layout
git commit -m "feat(web): compact top bar, navy bottom bar and a viewport-high shell that scrolls in <main>"
```

---

### Task 9: `useNavCounts`

**Files:**
- Create: `web/src/hooks/use-nav-counts.ts`, `web/src/hooks/use-nav-counts.test.tsx`
- Modify: `web/src/lib/constants.ts` (one key)

**Interfaces:**
- Consumes: `tasks.listTasks`, `meals.listShoppingItems`, `weorc.listOccurrences`, `feohImport.getImportStatus` (all in `web/src/api/`), `useHousehold()`, `todayInTimeZone`.
- Produces: `useNavCounts(): NavCounts` (type from `sidebar.tsx`); pure `countDueTasks(tasks: Task[], timeZone: string, now?: Date): number`; `QUERY_KEYS.weorcNavDue(today) = ['weorc', 'routines', 'navDue', today]`.

- [ ] **Step 1: Write the failing tests** `use-nav-counts.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { countDueTasks, useNavCounts } from './use-nav-counts';
import type { Task } from '@/lib/types';

const api = vi.hoisted(() => ({
  listTasks: vi.fn(), listShoppingItems: vi.fn(), listOccurrences: vi.fn(), getImportStatus: vi.fn(),
}));
vi.mock('@/api/tasks', () => ({ listTasks: api.listTasks }));
vi.mock('@/api/meals', () => ({ listShoppingItems: api.listShoppingItems }));
vi.mock('@/api/weorc', () => ({ listOccurrences: api.listOccurrences }));
vi.mock('@/api/feoh-import', () => ({ getImportStatus: api.getImportStatus }));
vi.mock('@/hooks/use-household', () => ({ useHousehold: () => ({ data: { data: { timezone: 'Pacific/Auckland' } } }) }));
const toast = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const task = (dueAt: string | null): Task => ({ id: dueAt ?? 'none', dueAt, status: 'open' } as Task);

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('countDueTasks', () => {
  // 2026-10-13 23:30 in Auckland (UTC+13) is 2026-10-13T10:30Z; "now" is noon there.
  const now = new Date('2026-10-12T23:00:00Z'); // 2026-10-13 12:00 Auckland
  it('counts by the household date, not UTC', () => {
    expect(countDueTasks([
      task('2026-10-13T10:30:00Z'), // 23:30 today in Auckland -> due
      task('2026-10-13T11:30:00Z'), // 00:30 tomorrow in Auckland -> not yet
      task('2026-10-01T09:00:00Z'), // overdue -> due
      task(null),                   // no due date -> not counted
    ], 'Pacific/Auckland', now)).toBe(2);
  });
});

describe('useNavCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listTasks.mockResolvedValue({ data: [task('2000-01-01T00:00:00Z')], meta: { total: 1 } });
    api.listShoppingItems.mockResolvedValue({ data: [{ checked: false }, { checked: true }, { checked: false }], meta: { total: 3 } });
    api.listOccurrences.mockResolvedValue({ data: [], meta: { total: 5 } });
    api.getImportStatus.mockResolvedValue({ data: { pendingCount: 7 } });
  });

  it('reads each count from its source', async () => {
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toEqual({ tasks: 1, shopping: 2, weorc: 5, feoh: 7 }));
    expect(api.listTasks).toHaveBeenCalledWith({ status: 'open' });
    expect(api.listOccurrences).toHaveBeenCalledWith({ status: 'due', due_to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('a failing source yields undefined, no toast, others unaffected', async () => {
    api.getImportStatus.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.tasks).toBe(1));
    await waitFor(() => expect(api.getImportStatus).toHaveBeenCalled());
    expect(result.current.feoh).toBeUndefined();
    expect(toast).not.toHaveBeenCalled();
  });
});
```

(The 401 path is the API client's own, unchanged — `client.ts:36-40` logs out before the query sees the error; `useNavCounts` adds nothing to it, so it needs no test of its own here.)

- [ ] **Step 2: Run** `cd web && npx vitest run src/hooks/use-nav-counts.test.tsx` — FAIL (module missing).

- [ ] **Step 3: Implement**

`constants.ts`, inside `QUERY_KEYS`:

```ts
  /** The nav's Weorc badge. Under ['weorc','routines'] on purpose: every
   *  Weorc mutation invalidates that prefix, so completing a chore anywhere
   *  refreshes the badge too. */
  weorcNavDue: (today: string) => ['weorc', 'routines', 'navDue', today] as const,
```

`use-nav-counts.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import { todayInTimeZone } from '@/lib/format';
import { useHousehold } from '@/hooks/use-household';
import * as tasks from '@/api/tasks';
import * as meals from '@/api/meals';
import * as weorc from '@/api/weorc';
import * as feohImport from '@/api/feoh-import';
import type { Task } from '@/lib/types';
import type { NavCounts } from '@/components/layout/sidebar';

/** Badges are decoration on the nav: fetched rarely, never retried, never
 *  surfaced as an error. A 401 still logs out - that happens in the API client. */
const BADGE_QUERY = { staleTime: 5 * 60_000, retry: false } as const;

/** Open tasks whose due date, read in the household's zone, is today or earlier. */
export function countDueTasks(list: Task[], timeZone: string, now: Date = new Date()): number {
  const today = todayInTimeZone(timeZone, now);
  return list.filter((t) => t.dueAt != null && todayInTimeZone(timeZone, new Date(t.dueAt)) <= today).length;
}

/** The four nav counts. Same query keys and functions as the pages, so the
 *  cache is shared and the pages' invalidations refresh the badges. */
export function useNavCounts(): NavCounts {
  const timeZone = useHousehold().data?.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayInTimeZone(timeZone);
  const openTasks = { status: 'open' } as const;

  const tasksQ = useQuery({ queryKey: [...QUERY_KEYS.tasks, openTasks], queryFn: () => tasks.listTasks(openTasks), ...BADGE_QUERY });
  const shoppingQ = useQuery({ queryKey: QUERY_KEYS.shoppingList, queryFn: () => meals.listShoppingItems(), ...BADGE_QUERY });
  const weorcQ = useQuery({
    queryKey: QUERY_KEYS.weorcNavDue(today),
    queryFn: () => weorc.listOccurrences({ status: 'due', due_to: today }),
    ...BADGE_QUERY,
  });
  const feohQ = useQuery({ queryKey: QUERY_KEYS.importStatus, queryFn: () => feohImport.getImportStatus(), ...BADGE_QUERY });

  return {
    tasks: tasksQ.data ? countDueTasks(tasksQ.data.data, timeZone) : undefined,
    shopping: shoppingQ.data ? shoppingQ.data.data.filter((i) => !i.checked).length : undefined,
    weorc: weorcQ.data?.meta.total,
    feoh: feohQ.data?.data.pendingCount,
  };
}
```

`ListMeta` is `{ total: number; limit?; offset? }` (`web/src/lib/types.ts:470`); the Weorc route fills `total` (`src/modules/weorc/routes.ts:76-85`). No toast fires on a query error anywhere in the app — toasts are raised by components, not by the QueryClient — so swallowing an error only means not rendering it.

- [ ] **Step 4: Run** the test — PASS. Then `cd web && npx tsc -b --noEmit` — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/use-nav-counts.ts web/src/hooks/use-nav-counts.test.tsx web/src/lib/constants.ts
git commit -m "feat(web): nav counts for tasks due, shopping left, Weorc due and Feoh imports"
```

---

### Task 10: Wire the counts into the shell

**Files:**
- Modify: `web/src/components/layout/app-shell.tsx`
- Modify: `web/src/components/layout/app-shell.test.tsx`

**Interfaces:**
- Consumes: `useNavCounts` (Task 9), `Sidebar({ counts })` (Task 7), `MobileNav({ counts })` (Task 8).

- [ ] **Step 1: Extend the test** — add the `vi.mock('@/hooks/use-nav-counts', …)` returning `{ tasks: 2, shopping: 0, weorc: undefined, feoh: 1 }`, and:

```tsx
  it('passes the nav counts to the sidebar', async () => {
    renderShell();
    await screen.findByRole('main');
    expect(document.querySelectorAll('aside [data-nav-badge]')).toHaveLength(2);
  });
```

- [ ] **Step 2: Run** — FAIL (0 badges).

- [ ] **Step 3: Implement** — in `AppShell`: `const counts = useNavCounts();`, then `<Sidebar counts={counts} />` and `<MobileNav counts={counts} />`; import from `@/hooks/use-nav-counts`.

- [ ] **Step 4: Run** `cd web && npx vitest run` — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/layout/app-shell.tsx web/src/components/layout/app-shell.test.tsx
git commit -m "feat(web): show the nav count badges"
```

---

### Task 11: Colour guard

**Files:**
- Create: `web/src/colour-guard.test.ts`

**Interfaces:**
- Produces: `PENDING_SWEEP` — the set of files still carrying hard-coded palette classes; Tasks 12–13 shrink it to empty and Task 13 deletes it.

- [ ] **Step 1: Write the guard**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Hard-coded Tailwind palette classes. Presentation colour must come from the
 *  theme tokens in index.css, or dark Slate breaks. Same pattern as the spec. */
const PALETTE = /\b(bg|text|border|ring|divide|from|to|fill|stroke|placeholder|outline|accent|shadow)-(white|black|(gray|slate|zinc|neutral|stone|red|green|blue|yellow|orange|amber|emerald|indigo|purple|pink|rose|teal|cyan|lime|violet|sky|fuchsia)-[0-9]{2,3})\b/g;
const HEX = /#[0-9a-fA-F]{6}\b/g;

/** Allowed per file, with the reason. Theme values must be literal (a <meta>
 *  cannot read a CSS variable); data colours are member/calendar identity. */
const ALLOW: Record<string, { classes?: string[]; hex?: true; why: string }> = {
  'lib/theme.ts': { hex: true, why: 'theme: browser chrome colours' },
  'lib/constants.ts': { hex: true, why: 'data: member avatar palette' },
  'lib/hearth.ts': { hex: true, why: 'data: wall display member/household colours' },
  'components/ui/member-avatar.tsx': { classes: ['text-white'], why: 'data: initials on a member colour' },
  'components/hearth/event-chip.tsx': { classes: ['text-white'], why: 'data: text on a member colour' },
};

/** Files not swept yet. Shrinks to empty in Tasks 12-13, then goes away. */
const PENDING_SWEEP = new Set<string>([
  // fill from the first run's output (Step 2)
]);

const SRC = resolve(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('colour guard', () => {
  it('no presentation colour outside the theme tokens', () => {
    const offenders: string[] = [];
    for (const path of files(SRC)) {
      const rel = relative(SRC, path).replaceAll('\\', '/');
      if (PENDING_SWEEP.has(rel)) continue;
      const text = readFileSync(path, 'utf8');
      const allow = ALLOW[rel];
      const classes = [...text.matchAll(PALETTE)].map((m) => m[0]).filter((c) => !allow?.classes?.includes(c));
      const hexes = allow?.hex ? [] : [...text.matchAll(HEX)].map((m) => m[0]);
      for (const hit of [...classes, ...hexes]) offenders.push(`${rel}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it('PENDING_SWEEP lists only files that still need it', () => {
    for (const rel of PENDING_SWEEP) {
      const text = readFileSync(join(SRC, rel), 'utf8');
      expect(PALETTE.test(text) || HEX.test(text), `${rel} is clean - remove it from PENDING_SWEEP`).toBe(true);
      PALETTE.lastIndex = 0; HEX.lastIndex = 0;
    }
  });
});
```

- [ ] **Step 2: Run** `cd web && npx vitest run src/colour-guard.test.ts` — FAIL, listing offenders. Copy every distinct file path from the failure into `PENDING_SWEEP` (expected: the feature/page files from Task 12–13's lists; `components/ui/*` and `components/layout/*` should already be clean after Tasks 4–8 — if one appears, fix it now instead of listing it). If `event-chip.tsx` turns out not to put text on a member colour, drop its allowlist entry and list it as pending instead.

- [ ] **Step 3: Run** — PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/colour-guard.test.ts
git commit -m "test(web): guard against hard-coded colours outside the theme tokens"
```

---

### Task 12: Sweep — feature components

**Files (each listed in `PENDING_SWEEP`):**
`components/calendar/event-form.tsx`, `components/dashboard/supper-card.tsx`, `components/ethel/{decommission-dialog,facility-details,vehicle-details}.tsx`, `components/feoh/{bills-list,envelope-card,import-accounts,import-inbox,import-rules,reconcile-dialog,transaction-form}.tsx`, `components/gewrit/{documents-panel,link-document-dialog,preview-dialog}.tsx`, `components/hearth/{add-event-overlay,display-prefs-modal,recipe-overlay}.tsx`, `components/household/{api-keys-panel,connections-panel,member-form,members-table}.tsx`, `components/library/connections-panel.tsx`, `components/meals/{recipe-form,shopping-list}.tsx`, `components/profile/provider-card.tsx`, `components/pwa/update-banner.tsx`, `components/settings/calendar-sync-settings.tsx`
- Modify: `web/src/colour-guard.test.ts` (remove each file from `PENDING_SWEEP`)

**Mapping** (apply by meaning; opacity modifiers carry over, e.g. `bg-black/40` → `bg-backdrop`):

| Hard-coded | Token class |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-gray-50` / `bg-gray-100` | `bg-surface-2` / `bg-surface-3` |
| `bg-gray-300` / `bg-gray-400` (track, placeholder fill) | `bg-line-strong` / `bg-faint` |
| `border-gray-200` / `border-gray-300` | `border-line` / `border-line-strong` |
| `text-gray-900` / `-800` / `-700` | `text-fg` |
| `text-gray-600` / `-500` | `text-muted` |
| `text-gray-400` | `text-faint` |
| `text-red-500/600/700/800` | `text-danger` |
| `bg-red-50` / `bg-red-100` | `bg-danger-bg` |
| `border-red-200` | `border-danger-border` |
| `bg-red-600` / `bg-red-700` (solid) | `bg-danger` (+ `text-on-primary`) |
| `text-green-*` / `text-emerald-*` | `text-success` |
| `bg-green-50/100` / `bg-emerald-100` | `bg-success-bg` |
| `border-green-200` | `border-success-border` |
| `bg-green-500` (dot/solid) | `bg-success` |
| `text-amber-*` / `text-yellow-800` | `text-warning` |
| `bg-amber-100` / `bg-yellow-50/100` | `bg-warning-bg` |
| `border-yellow-300` | `border-warning-border` |
| `bg-yellow-500` (dot/solid) | `bg-warning` |
| `text-blue-600` / `bg-blue-600` | `text-primary` / `bg-primary` |
| `bg-blue-50` / `border-blue-200` | `bg-primary-light` / `border-primary-border` |
| `ring-blue-500` | `ring-primary` |
| `text-white` on a token-coloured solid | `text-on-primary` |
| `border-white` | `border-surface` |
| `bg-black/NN` overlay | `bg-backdrop` |

- [ ] **Step 1:** For each file in the list: replace every hard-coded class per the table, remove the file from `PENDING_SWEEP`, run `cd web && npx vitest run src/colour-guard.test.ts <the file's own test if any>`. Work through the list in the order given; commit every 5–8 files.

- [ ] **Step 2: Run** `cd web && npx vitest run && npx tsc -b --noEmit` — PASS. Assertions on old class names are updated; behaviour assertions are not touched.

- [ ] **Step 3: Commit** (per batch)

```bash
git add web/src/components web/src/colour-guard.test.ts
git commit -m "refactor(web): feature components use theme tokens instead of fixed colours"
```

---

### Task 13: Sweep — pages, retire `PENDING_SWEEP`

**Files:** `pages/{calendar,ethel,feoh,hearth,library,login,profile,tasks}.tsx`, `web/src/colour-guard.test.ts`

- [ ] **Step 1:** Same procedure and mapping as Task 12 for each page.

- [ ] **Step 2:** When the set is empty, delete `PENDING_SWEEP`, its `continue` line and the second `it(...)` from `colour-guard.test.ts`.

- [ ] **Step 3: Run** `cd web && npx vitest run && npx tsc -b --noEmit && npm run build` — PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages web/src/colour-guard.test.ts
git commit -m "refactor(web): pages use theme tokens; the colour guard has no exceptions left"
```

---

### Task 14: Switch on Slate dark

**Files:**
- Modify: `web/src/index.css`, `web/src/index-css.test.ts`

- [ ] **Step 1: Add the failing test** to `index-css.test.ts`:

```ts
  it('Slate follows a dark device; Hearth stays light', () => {
    const dark = block("@media (prefers-color-scheme: dark) {");
    expect(dark).toContain(":root:not([data-theme='hearth'])");
    for (const t of TOKENS) expect(dark, t).toContain(`--color-${t}:`);
    expect(dark).toContain('color-scheme: dark');
  });
```

(`block` stops at the first `\n}` — write the media query with its inner rule indented so the closing brace of the inner rule is `\n  }` and only the media query's own closing brace is at column 0.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — append after the Hearth block in `index.css` (values are the mockup's dark palette, lines 28–44):

```css
/* Slate dark: follows the device. Hearth has no dark palette. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='hearth']) {
    --color-ground: #0f1217;
    --color-surface: #171b22;
    --color-surface-2: #1c2129;
    --color-surface-3: #232933;
    --color-line: #2a303b;
    --color-line-strong: #3b4250;
    --color-fg: #e6e8ec;
    --color-muted: #9aa3b2;
    --color-faint: #6f7886;
    --color-primary: #5b8def;
    --color-primary-hover: #7aa3f3;
    --color-primary-light: #16223a;
    --color-primary-border: #2a4474;
    --color-on-primary: #0b1020;
    --color-success: #4cc27a; --color-success-bg: #10261a; --color-success-border: #1f5a35;
    --color-danger: #f07171;  --color-danger-bg: #2a1515;  --color-danger-border: #5c2626;
    --color-warning: #f0ac45; --color-warning-bg: #2a1f0c; --color-warning-border: #5c4415;
    --color-accent: #a78bfa;  --color-accent-bg: #211a36;  --color-accent-border: #3d2f66;
    --color-info: #5cb8ec;    --color-info-bg: #0e2130;    --color-info-border: #1d4560;
    --color-nav: #0b0e13;
    --color-nav-fg: #e7eaf0;
    --color-nav-muted: #7d8595;
    --color-nav-hover: #161b23;
    --color-nav-active: #1f2632;
    --color-backdrop: rgb(0 0 0 / 0.6);
    --shadow-pop: 0 8px 28px rgb(0 0 0 / 0.5);
    color-scheme: dark;
  }
}
```

- [ ] **Step 4: Run** `cd web && npx vitest run && npm run build` — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/index.css web/src/index-css.test.ts
git commit -m "feat(web): Slate follows the device into dark mode"
```

---

### Task 15: Visual pass and fixes

**Files:** whatever the pass turns up; each fix is its own small commit.

- [ ] **Step 1: Bring up the dev stack** per `../.agents/skills/wyrhta-dev-env/SKILL.md` (meta repo), Heorth at `http://localhost:14000`, rebuilt from this branch.

- [ ] **Step 2: Walk every route** — `/`, `/today`, `/calendar`, `/tasks`, `/shopping`, `/capture`, `/meals`, `/feoh`, `/ethel`, `/weorc`, `/library`, `/household/*` (each tab), `/profile`, `/login`, `/hearth` — at 1440px, 1000px (rail) and 390px, with the OS (or DevTools "Emulate CSS prefers-color-scheme") set to light and to dark. Check: no white or bright patch in dark; section tints legible in dark (raise the `color-mix` percentages in `section-tone.tsx` under a dark-only selector if not); badges on Tasks/Shopping/Weorc/Feoh and absent at zero; a dialog on a long page does not let the page scroll; `/hearth` legible at distance in dark; switch the household to Hearth once and check every page renders without breakage.

- [ ] **Step 3:** Fix what the pass finds, with a test where the fix is behaviour (not pure styling). Run `cd web && npx vitest run && npx tsc -b --noEmit && npm run build` and the server suite `npx vitest run` (with a `_test` database) before the last commit.

- [ ] **Step 4:** Add a `CHANGELOG.md` entry under the unreleased section: Slate is the default theme and takes the new look (grouped navy sidebar with count badges, mockup buttons/cards/chips, dark mode following the device); Hearth stays selectable, light only.

- [ ] **Step 5: Commit**

```bash
git add -A web CHANGELOG.md
git commit -m "fix(web): visual pass for the Slate look in light and dark"
```
