# Web i18n: make `household.locale` drive the UI (issue #4)

**Date:** 2026-07-27
**Issue:** [#4 — Household locale is stored but nothing consumes it, UI stays English](https://github.com/Wyrhta-Labs/Heorth/issues/4)
**Scope decision:** full coverage in one branch — Hearth View first, then phone
screens, then main pages, then settings/admin. German uses the informal *du*.

## Problem

The settings page stores a validated `household.locale` (issue #2), but nothing
reads it. The web app has no i18n layer: every UI string is a hardcoded English
literal and all date/time rendering uses date-fns' default English locale
(`format('EEEE')`, `'h:mm a'`, a hardcoded `['Mon','Tue',…]` month header).
The Phase 2 exit criterion is spouse acceptance of the wall display, which must
speak German.

Constraint discovered in exploration: the server supports **17 locales**
(`src/household/options.ts` `SUPPORTED_LOCALES`) while this work ships **2
message catalogs** (en, de). Text language and date/number formatting therefore
resolve independently.

## Design

### 1. Dependencies & module layout

Add `i18next` + `react-i18next` to `web/` (nothing added to the backend).
New `web/src/i18n/`:

- `locales/en.json`, `locales/de.json` — single namespace, keys nested by area
  (`hearth.nowNext.happeningNow`, `nav.calendar`, `common.tryAgain`). English
  is the source catalog. German is informal (*du*).
- `index.ts` — initializes the **default i18next instance** at module import
  (`i18n.use(initReactI18next).init(...)`) with both catalogs statically
  bundled, `lng: 'en'`, `fallbackLng: 'en'`, **no browser language
  detector** — the household setting is the only driver (wall-display use
  case; household-wide, not per-member). Using the default instance means
  `useTranslation()` works without an `I18nextProvider` wrapper, which keeps
  the existing per-test provider wiring unchanged.
- `i18next.d.ts` — module augmentation typing `t()` keys against `typeof en`;
  literal keys are type-checked (dynamic key construction is avoided; catalog
  parity and interpolation are covered by tests, not types).
- `locale-map.ts` — maps each of the 17 supported locales to
  `{ language: 'en' | 'de', dateFnsLocale: Locale }`. date-fns does **not**
  ship a region variant for every tag (verified against the installed 4.4.0:
  no `de-CH`, `fr-FR`, `es-ES`, `pt-PT`, …), so regions map to the closest
  existing locale:
  - `de-DE` → `de`, `de-AT` → `deAT`, `de-CH` → `de` — all three use the `de`
    catalog.
  - Everything else → `en` catalog with its closest date-fns locale:
    `en-AU`/`en-CA`/`en-GB`/`en-US` exist as-is; `fr-FR` → `fr`,
    `es-ES` → `es`, `it-IT` → `it`, `pt-PT` → `pt`, `nl-NL` → `nl`,
    `da-DK` → `da`, `fi-FI` → `fi`, `nb-NO` → `nb`, `pl-PL` → `pl`,
    `sv-SE` → `sv` (English UI text, locale-correct day/month names and
    time format).
  - Unknown/legacy values → `en` + `enUS`.
  - A test resolves all 17 `SUPPORTED_LOCALES` values through the map and
    asserts each yields a real date-fns `Locale` object.

### 2. Provider & wiring

`I18nProvider` in `web/src/hooks/use-i18n.tsx` (same convention as
`AuthProvider`). Mounted in `app.tsx` **inside `QueryClientProvider`, around
`RouterProvider`** — one mount point covering login, the AppShell pages, and
`/hearth`, which renders outside the shell (same reasoning as the root-route
`UpdateBanner`).

The provider consumes the household query **gated on auth**
(`enabled: isAuthenticated` via `useAuth()`), so mounting it globally does not
fire `/api/v1/household` requests on `/login` or while unauthenticated — the
API client clears the stored token on 401, and an ungated query would trigger
that side effect. While disabled/loading it stays on the `en`/`enUS` defaults,
and it resets to those defaults on logout. When data arrives (or changes) it
resolves the locale through `locale-map.ts`, calls `i18n.changeLanguage(...)`,
and exposes the date-fns locale via context. Saving household settings already
invalidates `['household']`, so a locale change propagates live without a
reload.

### 3. Date/time formatting

`web/src/lib/format.ts` stays a module of pure functions, each gaining a
`locale` parameter; a new `useFormatters()` hook (subscribed to the i18n
context) curries them for components. The context has a **safe `enUS`
default**, so components rendered outside `I18nProvider` (existing tests)
format in English rather than throwing. Consumers (16 files) switch from
direct imports to the hook.

- Localized format tokens replace hardcoded patterns: `'MMM d, yyyy'` → `PP`,
  `'h:mm a'` → `p` (de renders `09:30`, en-US keeps `9:30 AM`), `'EEEE'` /
  `'EEE'` / `'d MMMM'` / `'MMMM yyyy'` pass the locale.
- `weekStartsOn` comes from the date-fns locale instead of hardcoded Monday —
  in `lib/format.ts` (`weekDays()`) **and** `lib/calendar-grid.ts`, which also
  hardcodes Monday; both take the locale so month-grid cells and weekday
  headers can't misalign.
- Data-key formats (`yyyy-MM-dd`, `yyyy-MM`, `dayLabel().iso`) remain
  locale-free.
- Calendar-day labels keep the existing **browser-local timezone semantics**
  (explicit decision): the wall display and phones physically live in the
  household's timezone; threading `household.timezone` through
  `Intl.DateTimeFormat` is out of scope.
- `components/hearth/hearth-month.tsx`'s hardcoded `DOW` array is generated
  from the locale.
- `components/hearth/day-column.tsx`'s
  `toLocaleDateString(undefined, { weekday: 'short' })` uses the household
  locale instead of the browser default.
- `formatMoney` formats numbers with the household locale; **currency stays
  hardcoded USD** — a currency setting is a follow-up, out of scope here.

### 4. String sweep (~35–40 files)

All user-facing literals become catalog keys, in this order:

1. i18n infra + `lib/format.ts` re-plumb.
2. Hearth View: `pages/hearth.tsx`, `components/hearth/*` (now-next-strip,
   event-chip, day-column, hearth-month, hearth-week, recipe-overlay),
   including the view toggle (`week`/`month`), aria-labels, sync-status and
   transient messages.
3. Phone screens: `pages/today.tsx`, `pages/shopping.tsx`, `pages/capture.tsx`.
4. Main pages: dashboard, calendar, tasks, meals, feoh, library, login, and
   their components.
5. Settings/admin + layout: `components/household/*`,
   `components/layout/*` (`navItems`, `PAGE_TITLES`), PWA banners.
6. Cross-cutting: `lib/constants.ts` label pairs become key-based and resolve
   at render; user-facing `api/client.ts` error strings; `lib/hearth.ts`
   `formatAge` **stays a pure function** — it takes a translate function (or
   moves into `useFormatters()`) rather than calling the global `i18n.t`, and
   uses `count`-based plural keys (`sync.age.minute_one` / `minute_other`, …)
   so i18next's `Intl.PluralRules` handling applies.

Non-translatable values (brand names like LibraryThing/Microsoft 365, member
names, ISO keys) stay literal.

### 5. Tests

- `web/tests/setup.ts` imports `src/i18n`, initializing the default instance
  with the `en` catalog, and adds `afterEach(() => i18n.changeLanguage('en'))`
  so German-rendering tests can't leak language into later tests. Combined
  with the `enUS` default formatter context, the 16 existing English-literal
  test files keep passing without per-test provider changes;
  `lib/format.test.ts` passes `enUS` explicitly.
- New tests: locale-map resolution of **all 17** supported values to a real
  date-fns `Locale`; provider switches language when household data changes
  and stays quiet while unauthenticated; Hearth renders German under `de-DE`
  (weekday names, 24h time, key strings); catalog parity (en/de key sets
  identical **and** each key's interpolation placeholder set — `{{count}}`
  etc. — matches across languages, so placeholder drift can't hide in de).
- Backend: update the now-false doc comment at `src/household/options.ts:30-34`
  ("Heorth has no message catalogues yet").

## Out of scope

- Currency/EUR handling (`formatMoney` keeps USD) — follow-up issue.
- Catalogs beyond en/de; per-member locale; backend/API string localisation;
  MCP surface.
