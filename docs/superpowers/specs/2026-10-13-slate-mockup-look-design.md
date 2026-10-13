# Slate Takes the Mockup's Look and Becomes the Default — Design

**Date:** 2026-10-13
**Status:** Draft (awaiting review)
**Branch:** `feat/slate-mockup-look`
**Reference:** `~/projects/wus-technik/decision-platform/mockup-jaguar-app.html`
(the `#approvals` view; its `<style>` block is the source for every value below)
**Builds on:** `0e5d9e8` (household theme, `slate`), `62b11c3` (section accents, zebra rows)

## Goal

Heorth's web UI looks like the Jaguar mockup: its app shell, its buttons, its
cards, its chips, its icon treatment, and its dark mode. That look is the
`slate` theme, and `slate` becomes the default theme.

Slate already has the mockup's light colours — it was modelled on the sibling
invoice-approval mockup. What it lacks is everything a colour token cannot
carry: the shell's structure, the button and card shapes, the density, and a
dark palette. Today a theme can only redefine colours and fonts, so Slate wears
Hearth's shapes in blue.

## Decisions (from brainstorming, 2026-10-13)

- **Reshape `slate`**, not a third theme and not a replacement of the theme
  switch. `hearth` stays selectable.
- **Slate is the main theme.** Hearth may shift or degrade where that makes the
  work simpler; it is not verified pixel by pixel.
- **Dark mode follows the device** (`prefers-color-scheme`), Slate only. No
  household or per-user setting.
- **Navigation gets groups and count badges**, in both themes.
- **Four badges**, each counting what needs action now: Tasks, Shopping, Weorc,
  Feoh.
- **Approach: extend the theme tokens.** One component tree; shapes that differ
  between themes become tokens, and what a token cannot express becomes a
  variant on the shared primitive. No per-theme React branches, no
  `[data-theme]` overrides of component internals.

## Out of scope

- The mockup's split list/detail layout, document viewer, action bar and
  calendar panel. Those are that app's screens; Heorth's page layouts stay.
- The mockup's Font Awesome document-type glyphs (Dolibarr object icons).
- A dark palette for Hearth.
- A user-facing light/dark switch.
- Replacing the three mobile tabs with an all-items bar.
- Any new server endpoint. Every badge reads an endpoint that exists.

## 1. Theme foundation

### Tokens

`web/src/index.css` keeps Tailwind's `@theme` block as the place tokens are
declared, so each one yields utilities (`bg-surface-2`, `text-muted`,
`border-strong`). The token set becomes the mockup's:

| Group | Tokens |
|---|---|
| Ground | `bg`, `surface`, `surface-2`, `surface-3` |
| Lines | `border`, `border-strong` |
| Text | `text`, `text-muted`, `text-light` |
| Primary | `primary`, `primary-hover`, `primary-light`, `primary-border`, `on-primary` |
| Status | `success`, `warning`, `danger`, `info`, `accent` — each with `-bg` and `-border` |
| Nav | `nav-bg`, `nav-fg`, `nav-muted`, `nav-hover`, `nav-active` |
| Overlay | `backdrop` |
| Shape | `radius` (8px), `radius-sm` (5px), `shadow-sm`, `shadow` |
| Type | `font-sans`, `font-serif`, `font-mono`, base size 13.5px |

The existing names (`parchment`, `linen`, `card`, `ink`, `ash`, `tan`, `ember`,
`ember-soft`, `taupe`, `sage`, `sky`, `amber`) are used in several hundred
class strings. They are **kept as aliases** onto the new tokens for this work
(`--color-card: var(--color-surface)`, `--color-ink: var(--color-text)`,
`--color-ember: var(--color-primary)`, …) and components touched by this work
move to the new names. Renaming the untouched remainder is not part of this
spec.

`section-tone.tsx`'s five accents map onto the status colours: `ember` →
primary, `sage` → success, `amber` → warning, `sky` → info, `taupe` → accent.

### Blocks

- `:root` — **Slate light** (the mockup's `:root` values). Slate is the default,
  so it owns `:root`.
- `@media (prefers-color-scheme: dark) { :root:not([data-theme='hearth']) }` —
  **Slate dark**, the mockup's dark palette, plus `color-scheme: dark`.
- `:root[data-theme='hearth']` — **Hearth**: today's warm values for the tokens
  it already had, and warm equivalents for the new ones. Light only.

Hearth's serif headings stay Hearth's: the `h1–h4` font rule reads
`--font-serif`, which Slate points at its sans.

The Slate-specific `--tw-shadow` overrides and the `h1–h4` weight override in
today's `index.css` go away: shadows and heading weight become token-driven.

### Default theme

- `src/household/options.ts`: `DEFAULT_THEME = 'slate'`; Slate listed first.
- `src/household/schema.ts`: column default `'slate'`, with a generated
  migration (`npm run db:generate -- --name appearance_default_slate`).
- `web/src/lib/theme.ts`: `DEFAULT_THEME = 'slate'`.
- `web/index.html`: `theme-color` meta starts at Slate's primary.

**A household whose row already says `hearth` keeps it** until an admin switches
in the household settings. The migration changes the column default only. A
household with no row (the common case — the row is written on first change)
moves to Slate with the new default.

### Browser chrome colour

`theme.ts` sets `<meta name="theme-color">` per theme. For Slate it must follow
light/dark, so `index.html` carries two metas with `media` attributes and
`applyTheme` writes both (Hearth writes the same value to both).

## 2. Primitives

All in `web/src/components/ui/`. Each keeps its export names and props; variant
names change where stated, and call sites are updated in the same commit.

- **`button.tsx`** — base: `radius-sm`, 1.5px transparent border, weight 600,
  13px, gap 6px, disabled at 45% opacity. Variants: `primary` (default),
  `ghost` (strong border, muted text), `danger`, `warning`, `success`, `link`.
  `danger` and `warning` are the mockup's tinted style (status background,
  status border, status text); `success` is solid. Sizes: `default`, `sm`,
  `icon`. The old names map as `default` → `primary`, `destructive` → `danger`,
  `outline` and `secondary` → `ghost`; today's borderless `ghost` uses (icon
  buttons in rows) take `ghost` with `size="icon"`. `lg` is dropped if unused,
  kept otherwise.
- **`card.tsx`** — `surface` ground, `border`, `radius`, `shadow-sm`.
  `CardHeader` becomes the mockup's strip: `surface-2` ground, bottom border,
  10px/16px padding, row layout. `CardTitle` is 13px bold. `CardContent` is
  14px/16px padding and no longer assumes a header above it.
- **`section-tone.tsx`** — `SectionTitle` renders the icon in a 24px tinted
  square (`-bg` ground, status colour), 14px glyph. `SectionCard` keeps its
  props. The card's own tint and the four shade steps are **kept**: they are
  what tells sections apart on Feoh and Ethel, and the mockup has no equivalent
  to replace them with. The header strip takes the tint instead of `surface-2`
  on a toned card.
- **`badge.tsx`** — the mockup's chip: pill, 11px, weight 600, 1px border.
  Variants `neutral` (default), `ok`, `warn`, `bad`, `info`, `accent`,
  `primary`. Old names map as `secondary`/`outline` → `neutral`, `success` →
  `ok`, `warning` → `warn`, `destructive` → `bad`, `default` → `primary`.
- **`input.tsx`, `textarea.tsx`** — `border-strong`, 6px radius, `surface`
  ground, focus ring in `primary`.
- **`table.tsx`** — header cells 10px uppercase on `surface-2` with a 1.5px
  bottom border; body cells 12.5px with tabular numerals; row hover
  `surface-2`. `zebra` stays and mixes from the new tokens.
- **`dialog.tsx`** — `backdrop` overlay, 10px radius, footer strip on
  `surface-2`.
- **`toast.tsx`** — inverted (`text` ground, `surface` text), 8px radius.
- **`tabs.tsx`** — the mockup's segmented control (`.seg`).
- **`progress.tsx`**, **`member-avatar.tsx`**, **`label.tsx`**,
  **`error-state.tsx`** — token names only.

### Icons

`lucide-react` stays; the mockup's inline SVGs are the same Feather glyphs.
What changes is treatment: 17px in the nav, 13–14px inline with text and in
buttons, 14px inside the 24px square in card headers. No glyph is swapped
unless the same concept has a different glyph in the mockup (`Settings2` →
`Settings`, `LayoutDashboard` stays — the mockup has no counterpart).

## 3. Shell

### Sidebar (`components/layout/sidebar.tsx`)

- `nav-bg` ground, 220px wide, 14px/10px padding.
- Brand: 30px rounded square in `primary` holding the flame, name beside it.
- `navItems` becomes grouped. `NavItem` gains `group: 'day' | 'household' | 'system'`
  and an optional `count` key; the exported flat `navItems` and
  `navItemsForFeatures` keep working for `mobile-nav.tsx` and the existing
  tests, and a new `navGroups()` returns the grouped view.

  | Group | Items |
  |---|---|
  | Day | This week, Today, Calendar, Tasks, Shopping, Capture, Meals |
  | Household | Feoh, Ethel, Weorc, Library |
  | System | Household, Hearth, KithLedger (when configured) |

- Item: 8px/10px padding, 6px radius, hover `nav-hover`, active `nav-active`
  with weight 650. The active item is no longer a solid primary block.
- Badge: `primary` pill at the right edge; absent at zero.
- Footer: avatar, display name and role, linking to `/profile`, with sign-out
  beside it. The top bar loses both.
- **Rail:** below 1100px the sidebar is 64px, labels and group headings hidden,
  icons centred, badge pinned to the icon's corner, each item carrying its
  label as `title`. Below `md` (768px) the sidebar is hidden and the bottom bar
  takes over, as today.

New i18n keys in `en.json` and `de.json`: `nav.group.day`,
`nav.group.household`, `nav.group.system`, and an accessible badge label
(`nav.countLabel`, "{{count}} open").

### Top bar (`components/layout/top-bar.tsx`)

52px, `surface` ground, bottom border, `shadow-sm`; title 15px bold in the sans.
It holds the title only. On phone widths, where the sidebar is hidden, it keeps
the avatar link to `/profile` (sign-out is already in the More sheet).

### Mobile bottom bar (`components/layout/mobile-nav.tsx`)

Same three tabs plus More. Restyled to `nav-bg` / `nav-fg`, active tab in
`nav-fg` at full strength, inactive in `nav-muted`. The Shopping tab shows its
badge. The More sheet lists the grouped items with their badges.

### App shell (`components/layout/app-shell.tsx`)

`bg` ground. The shell becomes a fixed-height grid (sidebar | main) with the
main column scrolling, so the sidebar and top bar stay put — the mockup's
behaviour, and what the rail needs. `/hearth` is outside the shell and
unaffected.

### Count badges (`web/src/hooks/use-nav-counts.ts`)

One hook returning `{ tasks, shopping, weorc, feoh }`, each a number or
`undefined` while unknown. It composes existing queries so the cache is shared
with the pages that show the same data:

| Badge | Source | Count |
|---|---|---|
| Tasks | `useTasks({ status: 'open' })` — the query the start page's due-work card already runs | tasks with `dueAt` on or before the household's today |
| Shopping | `useShoppingList()` | unchecked items |
| Weorc | `useOccurrences({ status: 'due', due_to: <today> })` | `meta.total`, or the row count if the endpoint is unpaginated |
| Feoh | `useImportStatus()` | `data.pendingCount` |

- "Today" is the household's local date, computed the way the start page's
  due-work card computes it — not from `toISOString()`.
- A query that errors or 404s (a module whose routes are not mounted) yields
  `undefined` and no badge. It must not raise a toast or an error state: a
  badge is decoration on the nav, not the page's content.
- Counts refresh through the pages' own invalidations, plus a 5-minute
  `staleTime` so navigating does not refetch four lists each time.
- The login page and `/hearth` do not mount the shell and run none of this.

## 4. Colour sweep

140 hard-coded Tailwind colour classes in 48 non-test files (`bg-white`,
`text-gray-900`, `bg-red-600`, `bg-yellow-100`, …) and 9 hex literals move onto
tokens. Dark mode is unusable until they do. Mapping:

| Hard-coded | Token |
|---|---|
| `white` ground | `surface` |
| `gray-50` / `gray-100` ground | `surface-2` / `surface-3` |
| `gray-200` / `gray-300` border | `border` / `border-strong` |
| `gray-900` / `gray-700` text | `text` |
| `gray-500` / `gray-600` text | `text-muted` |
| `gray-400` text | `text-light` |
| `red-*` | `danger` family |
| `green-*` / `emerald-*` | `success` family |
| `yellow-*` / `amber-*` / `orange-*` | `warning` family |
| `blue-*` / `sky-*` | `primary` or `info` by meaning |
| `purple-*` / `violet-*` | `accent` family |
| `black/NN` overlay | `backdrop` |
| `text-white` on a solid colour | `on-primary` |

Hex literals that are **data** stay: member avatar colours, the browser-chrome
colours in `theme.ts`, and any colour a user picked.

A guard keeps it done: a Vitest test that scans `web/src/**/*.{ts,tsx}`
(tests excluded) for the hard-coded palette pattern and fails on a match
outside an explicit allowlist.

## 5. Phases

Each phase leaves the app working and is committed on its own.

1. **Foundation** — tokens, aliases, the three blocks, default theme and
   migration, theme-color metas.
2. **Primitives** — the `ui/` components and their call-site renames.
3. **Shell** — sidebar groups and rail, top bar, bottom bar, app shell, i18n.
4. **Badges** — `useNavCounts` and its wiring.
5. **Sweep** — pages and feature components, with the guard test last.
6. **Visual pass** — every page, Slate light and Slate dark, in the dev stack;
   fixes land here.

## 6. Testing

- **Server:** `tests/household-routes.test.ts` — a household with no appearance
  row reports `slate`; `hearth` and `slate` both remain valid on PATCH.
- **Theme:** `web/src/lib/theme.test.ts` — default is `slate`; unknown values
  fall back to it; both theme-color metas are written.
- **Sidebar:** grouping (every item in exactly one group, KithLedger appended
  to System only when configured), active state, badge shown at >0 and absent
  at 0 and at `undefined`, accessible badge label.
- **`useNavCounts`:** each count from mocked query data; an errored query
  yields `undefined` without throwing; the Tasks count respects the household
  date boundary.
- **Primitives:** existing tests updated for renamed variants; `Button` and
  `Badge` render each variant.
- **Guard:** the hard-coded-colour scan.
- **Existing suites** stay green; assertions on class names that changed are
  updated, assertions on behaviour are not.
- **Visual pass:** dev stack (`deploy/compose.dev.yml`, port 14000), each route
  in `PAGE_TITLES` plus `/tasks`, `/login` and `/hearth`, at desktop, rail
  (~1000px) and phone widths, with the device set to light and to dark. Hearth
  gets one look per page for breakage, not for fidelity.

## Risks

- **Alias drift.** While old and new token names coexist, a component can mix
  them. The aliases are one-way (`old → new`), so both always resolve to the
  same colour.
- **Contrast in dark.** Section tints are `color-mix` over the card colour;
  on a dark card the same percentages read differently. The visual pass checks
  them and the mix percentages may need a dark-specific value.
- **The wall display in dark.** `/hearth` uses tokens throughout and will turn
  dark on a kiosk whose OS is dark. That is the intended behaviour; the pass
  confirms it is legible at wall distance.
- **Variant renames** touch many call sites. TypeScript catches every one —
  `cva` variants are typed — so a missed site is a compile error, not a silent
  fallback.
