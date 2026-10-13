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
| Type | `font-sans`, `font-serif`, `font-mono` |

**Density.** The mockup sets `body { font-size: 13.5px }`, which reaches only
inherited, unclassed copy. Heorth's root font size stays 16px: lowering it would
shrink Tailwind's whole `rem` scale — spacing, radii and dimensions too — by
about 16%. Instead `body` gets 13.5px for inherited copy, and the primitives
(§2) and shell (§3) set the mockup's pixel sizes explicitly. Page-level
`text-sm` / `text-xs` utilities are retuned where the visual pass shows they
read too large, not by a global change.

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
- `web/public/manifest.webmanifest`: `theme_color` becomes Slate's light
  primary. A manifest cannot follow device dark mode, so an installed PWA's
  splash and chrome stay static at that colour; the `<meta>` tags below take
  over once the page is running.

**A household whose row already says `hearth` keeps it** until an admin switches
in the household settings. The migration changes the column default only. A
household with no row (the common case — the row is written on first change)
moves to Slate with the new default.

### Browser chrome colour

`theme.ts` sets `<meta name="theme-color">` per theme. For Slate it must follow
light/dark, so `index.html` carries two metas with `media` attributes and
`applyTheme` writes both (Hearth writes the same value to both).

## 2. Primitives

All in `web/src/components/ui/`. Each keeps its export names, props **and
existing variant names**: the variants are restyled, not renamed, so the
visual hierarchy call sites rely on survives and no call site has to change.
New variants are added alongside.

- **`button.tsx`** — base: `radius-sm`, 1.5px transparent border, weight 600,
  13px, gap 6px, disabled at 45% opacity. Existing variants, restyled:

  | Variant | Uses (non-test) | Mockup style |
  |---|---:|---|
  | `default` | — | `.btn-primary`: solid primary |
  | `outline` | 48 | `.btn-ghost`: strong border, muted text, `surface-2` on hover |
  | `secondary` | 4 | filled `surface-3`, text colour, no border |
  | `ghost` | 12 | borderless, muted text, `surface-2` on hover |
  | `destructive` | 5 | `.btn-danger`: tinted danger ground, border and text |
  | `link` | — | `.btn-link` |

  Added: `warning` (`.btn-warning`, tinted) and `success` (`.btn-success`,
  solid). Sizes `default`, `sm`, `lg`, `icon` stay, retuned to the mockup's
  padding (`sm` = `.btn.sm`).
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
  Existing variants restyled: `default` → `.chip.pri`, `secondary` → filled
  neutral (`surface-3` ground, no visible border), `outline` → `.chip`
  (bordered `surface-2`), `success` → `.chip.ok`, `warning` → `.chip.warn`,
  `destructive` → `.chip.bad`. Added: `info` (`.chip.info`) and `accent`
  (`.chip.acc`).
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
  takes over, as today. This is a **deliberate deviation**: the mockup switches
  at 860px; Heorth keeps its existing `md` breakpoint so page layouts that
  already key off `md` do not shift.

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
unaffected (verified: `app.tsx:63-74`).

Mechanics: the shell root is `h-dvh` (not today's `min-h-screen`) with
`overflow-hidden`; the main column is `flex flex-col min-h-0`, and `<main>` is
`flex-1 min-h-0 overflow-y-auto`. That moves the scroll owner from the window
to `<main>`, which has two consequences the work must handle:

- `dialog.tsx` locks scrolling on `body`; it must lock the shell's `<main>`
  too, or the page scrolls under an open dialog.
- Scroll position on navigation: `<main>` is reset to the top on route change
  (the router's window scroll restoration no longer reaches it). No current
  page uses `position: sticky` or reads window scroll, so nothing else moves.

### Count badges (`web/src/hooks/use-nav-counts.ts`)

One hook returning `{ tasks, shopping, weorc, feoh }`, each a number or
`undefined` while unknown. It runs its own `useQuery` calls **with the same
query keys and query functions** the pages use, so the cache is shared with
those pages, and sets a 5-minute `staleTime` on them (the existing hooks do not
take query options, and are not changed for this):

| Badge | Query key / function | Count |
|---|---|---|
| Tasks | the `useTasks({ status: 'open' })` key, `tasks.listTasks({ status: 'open' })` | open tasks whose `dueAt`, read as a date in the household's time zone, is on or before the household's today |
| Shopping | `QUERY_KEYS.shoppingList`, `meals.listShoppingItems()` | items with `checked === false` |
| Weorc | the Weorc page's occurrences key, `weorc.listOccurrences({ status: 'due', due_to: <today> })` (`api/weorc.ts`, **not** Feoh's `useOccurrences`) | `meta.total` |
| Feoh | `QUERY_KEYS.importStatus`, `feohImport.getImportStatus()` | `data.pendingCount` |

- **Today** is `todayInTimeZone(household.timezone)` (`lib/format.ts`), the
  client counterpart of the server's `householdToday()`, as the Weorc page and
  the start page's due-work card use it. The Tasks count compares each
  `dueAt`'s date **in that zone** (`todayInTimeZone(tz, new Date(dueAt))`)
  against it — it does not pass a `due_to` date to the server, because the tasks
  endpoint reads `due_to` as an instant and a bare date would mean midnight UTC.
  Tasks without `dueAt` do not count.
- All four endpoints are always mounted and readable by every authenticated
  member (Feoh and Weorc are always-on modules; ingestion status answers even
  with import disabled, then with `pendingCount: 0`). So the failure cases are
  ordinary errors and offline. **Non-401 errors are swallowed**: the count is
  `undefined`, no badge, no toast, no error state, `retry: false`. A **401**
  keeps the client's existing global behaviour (logout and redirect to login) —
  the shell is no new path to that.
- **Offline:** the queries fail and the badges disappear; the Shopping badge
  does not read the offline shopping store.
- **Load:** the shell adds four requests on first mount (alongside its existing
  whoami/features/household requests); after that, the 5-minute `staleTime`
  and the pages' own invalidations keep them current without refetching on
  every navigation.
- The login page and `/hearth` do not mount the shell and run none of this.

## 4. Colour sweep

Hard-coded Tailwind palette classes (`bg-white`, `text-gray-900`,
`bg-red-600`, `bg-yellow-100`, …) and presentation hex literals move onto
tokens. Dark mode is unusable until they do. The inventory is whatever this
pattern finds in non-test `web/src/**/*.{ts,tsx}` — the same pattern the guard
test uses, so the guard's first run *is* the work list:

```
(bg|text|border|ring|divide|from|to|fill|stroke|placeholder|outline|accent|shadow)-(white|black|(gray|slate|zinc|neutral|stone|red|green|blue|yellow|orange|amber|emerald|indigo|purple|pink|rose|teal|cyan|lime|violet|sky|fuchsia)-[0-9]{2,3})
```

On 2026-10-13 it finds 140 matches in 48 files (a looser scan finds up to 164
in 52; the plan records the guard's own output as the baseline). Mapping:

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

Hex literals fall into three kinds, and only the last is swept:

- **Theme values** — `lib/theme.ts`'s browser-chrome colours: they must be
  literal, a `<meta>` cannot read a CSS variable.
- **Data** — member avatar colours (`lib/constants.ts`), the wall display's
  per-member and per-calendar colours (`lib/hearth.ts`), and any colour a user
  picked.
- **Presentation** — a hex used to paint UI chrome. These become tokens.

A guard keeps it done: a Vitest test that scans non-test
`web/src/**/*.{ts,tsx}` with the pattern above and fails on any match outside
an allowlist. The allowlist is explicit per file and per reason (the theme and
data files above); a new entry needs a comment saying which kind it is.

## 5. Phases

Each phase is committed on its own and leaves the build and the tests green.
They are **not** each a visual release: dark Slate is unusable until the sweep
is done. So the phases land on `feat/slate-mockup-look` and merge to `main`
together, after the visual pass. One implementation plan covers all six.

The **dark block is written in phase 1 but switched on in phase 5**, once the
sweep is through — until then the media query is absent, so every intermediate
commit renders light Slate correctly.

1. **Foundation** — tokens, aliases, the Slate-light and Hearth blocks, the
   (inactive) Slate-dark block, default theme and migration, manifest and
   theme-color metas.
2. **Primitives** — the `ui/` components restyled, new variants added.
3. **Shell** — sidebar groups and rail, top bar, bottom bar, app shell with
   its scroll mechanics and dialog scroll lock, i18n.
4. **Badges** — `useNavCounts` and its wiring.
5. **Sweep** — pages and feature components, the guard test, then dark switched
   on.
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
- **`useNavCounts`:** each count from mocked query data; a 500 yields
  `undefined` with no toast; a 401 still reaches the client's logout path; the
  Tasks count puts a task due at 23:30 household time on today and one due at
  00:30 the next household day on tomorrow, with the household zone differing
  from UTC; the Weorc count reads `meta.total` from the Weorc endpoint.
- **Shell:** opening a dialog locks the `<main>` scroller; navigating resets
  `<main>` to the top.
- **Primitives:** `Button` and `Badge` render every variant, old and new.
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
- **Restyled variants change many screens at once** (48 `outline` buttons
  alone). Names stay, so nothing breaks at compile time; the visual pass is
  where a button whose new style reads wrong in context gets caught.
