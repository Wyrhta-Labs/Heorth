# Hearth Wallboard Display Settings Modal — Design

**Date:** 2026-08-11
**Status:** Approved

## Goal

Replace the Hearth wall's single "reminders" toggle button with a modal that
toggles multiple wallboard elements: KithLedger reminders, tasks, meals/supper,
and the sync-staleness footer notes.

## Trigger button

- The header Bell button (currently a direct `showKithReminders` toggle) becomes
  the modal opener: `SlidersHorizontal` icon, label `hearth.display.button`
  ("Display" / "Anzeige").
- Shown **always** — not gated on `kithEnabled` — because it now governs
  tasks, meals, and the footer too.
- No `aria-pressed`; gets `aria-haspopup="dialog"`.

## Modal

- Small centered dialog (`role="dialog"`, `aria-modal="true"`) over a dim
  backdrop. Closes via an X button, tapping the backdrop, or Escape.
- Four large touch-friendly toggle rows; each is a labeled switch that applies
  **immediately** (no save button):
  1. **KithLedger reminders** — row rendered only when the features query
     reports `kithledger: true`.
  2. **Tasks**
  3. **Meals & supper**
  4. **Sync status footer** (the staleness notes line)

## Preferences storage (`web/src/lib/hearth-prefs.ts`)

- Consolidate into one localStorage key `heorth:hearth:display` holding
  `{ kithReminders, tasks, meals, staleFooter }`, all defaulting to `true`.
- On first load, migrate the legacy boolean key
  `heorth:hearth:show-kith-reminders` into the new object.
- Keep the existing safe read/write idiom (corrupt JSON / unavailable storage
  degrade to defaults).
- New API: `loadHearthDisplayPrefs()` / `saveHearthDisplayPrefs(prefs)`
  replacing `loadShowKithReminders` / `saveShowKithReminders`.

## Effect of each toggle

- **Reminders:** exactly today's behavior — Kith query disabled and
  `reminders: []` when off.
- **Tasks:** week/month views render without task rows; the due-today count in
  the now/next strip hides. Implemented by passing an empty task list into
  `composeDay` / `HearthMonth` when off — the tasks query keeps polling (cheap,
  no gating complexity).
- **Meals/supper:** meal rows hidden in week/month; supper slot hidden in the
  now/next strip. Same empty-list-at-composition approach.
- **Footer:** hides only the staleness-notes span; the "as of HH:mm" freshness
  stamp always stays (it is the wall's health indicator).

The now/next strip itself stays always-on.

## i18n

New strings under `hearth.display.*` in `en.json` and `de.json`: button label,
modal title, the four row labels, and the close-button aria label.

## Testing

- `hearth-prefs.test.ts`: new shape round-trip, defaults, legacy-key migration,
  corrupt JSON fallback.
- `hearth.test.tsx` (and `hearth.de.test.tsx` where strings surface): modal
  opens/closes, each toggle hides its element, persistence write on toggle,
  reminders row absent when KithLedger is disabled, button visible even when
  KithLedger is disabled.
