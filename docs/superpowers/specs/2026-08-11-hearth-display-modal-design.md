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

- Small centered dialog (`role="dialog"`, `aria-modal="true"`,
  `aria-labelledby` pointing at the modal title) over a dim backdrop.
- Closes via an X button, tapping the backdrop, or Escape. Backdrop taps close
  only when the event target IS the backdrop — taps inside the dialog never
  close it.
- Focus: moves into the dialog on open (close button or first switch), is
  trapped inside while open, and returns to the Display button on close.
  Switches are real buttons with `aria-pressed` (Space/Enter toggles).
- While the modal is open, the idle dim is suppressed — same guard as the
  recipe/add-event overlays.
- Stacking: the modal can only be opened from the base wallboard header. The
  recipe/add-event overlays are full-bleed and the modal's backdrop covers the
  wall, so the two can never be open simultaneously; no z-index contract
  beyond "modal above the wall" is needed.
- Four large touch-friendly toggle rows; each is a labeled switch that applies
  **immediately** (no save button):
  1. **KithLedger reminders** — row rendered only when the features query
     reports `kithledger: true`. While features are loading or errored the row
     is omitted; the stored preference is left unchanged.
  2. **Tasks**
  3. **Meals & supper**
  4. **Sync status footer** (the staleness notes line)

## Preferences storage (`web/src/lib/hearth-prefs.ts`)

- Consolidate into one localStorage key `heorth:hearth:display` holding
  `{ kithReminders, tasks, meals, staleFooter }`, all defaulting to `true`.
- Migration precedence: if `heorth:hearth:display` exists, it wins and the
  legacy key is ignored. Otherwise the legacy boolean
  `heorth:hearth:show-kith-reminders` (if present) seeds `kithReminders`; the
  legacy key is deleted after a successful write of the new object.
- Field validation: any missing or non-boolean field in the stored object
  falls back to `true` individually (partial objects are tolerated).
- Keep the existing safe read/write idiom (corrupt JSON / unavailable storage
  degrade to defaults).
- New API: `loadHearthDisplayPrefs()` / `saveHearthDisplayPrefs(prefs)`
  replacing `loadShowKithReminders` / `saveShowKithReminders`.

## Effect of each toggle

- **Reminders:** exactly today's behavior — Kith query disabled and
  `reminders: []` when off.
- **Tasks:** week/month views render without task rows; the now/next strip
  omits its **entire due-today panel** (not an empty panel). Implemented by
  passing an empty task list into `composeDay` / `HearthMonth` when off — the
  tasks query keeps polling (cheap, no gating complexity).
- **Meals/supper:** meal rows hidden in week/month; the now/next strip omits
  its **entire supper/tonight panel**. Same empty-list-at-composition
  approach. The strip's remaining panels reflow into the freed space.
- **Footer:** hides only the right-hand staleness-notes span. The left span —
  the "as of HH:mm" freshness stamp AND the "reconnecting" indicator — always
  stays (it is the wall's health indicator).

The now/next strip itself stays always-on.

## i18n

New strings under `hearth.display.*` in `en.json` and `de.json`: button label,
modal title, the four row labels, and the close-button aria label.

## Testing

- `hearth-prefs.test.ts`: new shape round-trip, defaults, legacy-key migration
  (including legacy key deleted after migration, and new key winning when both
  exist), partial/wrong-typed fields falling back per-field, corrupt JSON
  fallback.
- `hearth.test.tsx` (and `hearth.de.test.tsx` where strings surface): modal
  opens/closes (X, backdrop, Escape; inside-dialog taps do NOT close),
  each toggle hides its element, the due-today and supper panels disappear
  entirely from the now/next strip, "as of"/"reconnecting" survive the footer
  toggle, persistence write on toggle, reminders row absent when KithLedger is
  disabled, button visible even when KithLedger is disabled, idle dim
  suppressed while the modal is open.
