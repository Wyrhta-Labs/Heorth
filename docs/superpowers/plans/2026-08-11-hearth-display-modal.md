# Hearth Display Settings Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Hearth wall's single "Reminders" toggle button with a small centered modal that toggles four wallboard elements: KithLedger reminders, tasks, meals/supper, and the sync-staleness footer notes.

**Architecture:** A consolidated `HearthDisplayPrefs` object in localStorage (with migration from the legacy boolean key) drives what the wall renders. A new `DisplayPrefsModal` component (small centered dialog with focus trap) edits it; `hearth.tsx` applies each flag by feeding empty lists into the existing composition helpers (queries keep polling — no gating complexity beyond the existing Kith query gate).

**Tech Stack:** React 19 + TypeScript (web/), Vitest + Testing Library, react-i18next, lucide-react icons, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-11-hearth-display-modal-design.md`

## Global Constraints

- All commands run from the repo root; web commands are `cd web && ...`. Tests: `cd web && npx vitest run <file>`; full suite `cd web && npm test`.
- localStorage key: `heorth:hearth:display`; legacy key: `heorth:hearth:show-kith-reminders` (deleted after migration).
- All four prefs default to `true`; missing/non-boolean fields fall back to `true` **individually**; corrupt JSON / unavailable storage degrade to all-true defaults (never throw).
- i18n: every user-visible string goes through `t()` with keys under `hearth.display.*`, added to BOTH `web/src/i18n/locales/en.json` and `de.json`.
- The modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`; closes via X, direct-backdrop tap, Escape; focus moves to the close button on open, Tab is trapped, focus returns to the opener on close; toggle rows are real `<button>`s with `aria-pressed`.
- While the modal is open the idle dim must not render (same guard as recipe/add-event overlays).
- The "as of HH:mm" stamp and "Reconnecting…" indicator are NEVER hidden by the footer toggle — only the right-hand staleness-notes span.
- No new dependencies. Match existing code style (comment density, Tailwind idiom, `@/` imports).
- Commit after each task; conventional-commit messages; NO AI co-author trailers.

---

### Task 1: Consolidated display prefs with legacy migration

Add the new `HearthDisplayPrefs` API to `web/src/lib/hearth-prefs.ts` **alongside** the legacy functions (the page still imports them until Task 3 — the repo must stay green between tasks).

**Files:**
- Modify: `web/src/lib/hearth-prefs.ts`
- Test: `web/src/lib/hearth-prefs.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (Tasks 2–3 rely on these exact names):
  ```ts
  export interface HearthDisplayPrefs {
    kithReminders: boolean;
    tasks: boolean;
    meals: boolean;
    staleFooter: boolean;
  }
  export function loadHearthDisplayPrefs(): HearthDisplayPrefs;
  export function saveHearthDisplayPrefs(prefs: HearthDisplayPrefs): void;
  ```

- [ ] **Step 1: Write the failing tests**

Append this describe block to `web/src/lib/hearth-prefs.test.ts` (keep the existing `show-kith-reminders preference` block — it is deleted in Task 3). Extend the import line to include the new symbols:

```ts
import {
  loadShowKithReminders, saveShowKithReminders,
  loadHearthDisplayPrefs, saveHearthDisplayPrefs,
} from './hearth-prefs';

const DISPLAY_KEY = 'heorth:hearth:display';
const ALL_ON = { kithReminders: true, tasks: true, meals: true, staleFooter: true };

describe('hearth display preferences', () => {
  it('defaults to everything ON when nothing is stored', () => {
    expect(loadHearthDisplayPrefs()).toEqual(ALL_ON);
  });

  it('round-trips a full object under the documented key', () => {
    const prefs = { kithReminders: false, tasks: true, meals: false, staleFooter: true };
    saveHearthDisplayPrefs(prefs);
    expect(loadHearthDisplayPrefs()).toEqual(prefs);
    expect(JSON.parse(localStorage.getItem(DISPLAY_KEY)!)).toEqual(prefs);
  });

  it('tolerates corrupt storage (falls back to all-ON)', () => {
    localStorage.setItem(DISPLAY_KEY, '{not json');
    expect(loadHearthDisplayPrefs()).toEqual(ALL_ON);
  });

  it('falls back per-field for missing or wrong-typed fields', () => {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify({ tasks: false, meals: 'nope' }));
    expect(loadHearthDisplayPrefs()).toEqual({ ...ALL_ON, tasks: false });
  });

  it('migrates the legacy kith boolean into kithReminders and deletes the legacy key', () => {
    localStorage.setItem(KEY, 'false'); // KEY = legacy 'heorth:hearth:show-kith-reminders'
    expect(loadHearthDisplayPrefs()).toEqual({ ...ALL_ON, kithReminders: false });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(DISPLAY_KEY)!)).toEqual({ ...ALL_ON, kithReminders: false });
  });

  it('ignores the legacy key when the new key already exists', () => {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify({ ...ALL_ON, kithReminders: true }));
    localStorage.setItem(KEY, 'false');
    expect(loadHearthDisplayPrefs().kithReminders).toBe(true);
  });

  it('ignores a wrong-typed legacy value (no migration write)', () => {
    localStorage.setItem(KEY, '"yes"');
    expect(loadHearthDisplayPrefs()).toEqual(ALL_ON);
    expect(localStorage.getItem(DISPLAY_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/hearth-prefs.test.ts`
Expected: FAIL — `loadHearthDisplayPrefs` is not exported.

- [ ] **Step 3: Implement**

In `web/src/lib/hearth-prefs.ts`, keep `readJson`/`writeJson` and the legacy functions untouched, and add:

```ts
const DISPLAY_KEY = 'heorth:hearth:display';

/** Which wallboard elements the Hearth wall renders. All default ON. */
export interface HearthDisplayPrefs {
  kithReminders: boolean;
  tasks: boolean;
  meals: boolean;
  staleFooter: boolean;
}

function fieldOrTrue(v: unknown): boolean {
  return typeof v === 'boolean' ? v : true;
}

/**
 * Load the consolidated display prefs. Precedence: the new key wins outright;
 * otherwise a legacy `show-kith-reminders` boolean seeds `kithReminders` and
 * is migrated (written under the new key, legacy key deleted). Missing or
 * wrong-typed fields fall back to `true` individually.
 */
export function loadHearthDisplayPrefs(): HearthDisplayPrefs {
  const stored = readJson<Record<string, unknown>>(DISPLAY_KEY);
  if (stored && typeof stored === 'object') {
    return {
      kithReminders: fieldOrTrue(stored.kithReminders),
      tasks: fieldOrTrue(stored.tasks),
      meals: fieldOrTrue(stored.meals),
      staleFooter: fieldOrTrue(stored.staleFooter),
    };
  }
  const prefs: HearthDisplayPrefs = { kithReminders: true, tasks: true, meals: true, staleFooter: true };
  const legacy = readJson<unknown>(SHOW_KITH_REMINDERS_KEY);
  if (typeof legacy === 'boolean') {
    prefs.kithReminders = legacy;
    saveHearthDisplayPrefs(prefs);
    try {
      localStorage.removeItem(SHOW_KITH_REMINDERS_KEY);
    } catch {
      // Storage unavailable — the stale legacy key is harmless (new key wins).
    }
  }
  return prefs;
}

export function saveHearthDisplayPrefs(prefs: HearthDisplayPrefs): void {
  writeJson(DISPLAY_KEY, prefs);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/hearth-prefs.test.ts`
Expected: PASS (old + new describe blocks).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hearth-prefs.ts web/src/lib/hearth-prefs.test.ts
git commit -m "feat(hearth): consolidated display prefs with legacy kith migration"
```

---

### Task 2: DisplayPrefsModal component + i18n strings

A small centered dialog with four toggle rows. Purely presentational: receives prefs and callbacks, owns focus behavior.

**Files:**
- Create: `web/src/components/hearth/display-prefs-modal.tsx`
- Test: `web/src/components/hearth/display-prefs-modal.test.tsx`
- Modify: `web/src/i18n/locales/en.json` (inside the `"hearth"` object, after the `"kith"` entry)
- Modify: `web/src/i18n/locales/de.json` (same position)

**Interfaces:**
- Consumes: `HearthDisplayPrefs` from `@/lib/hearth-prefs` (Task 1).
- Produces (Task 3 relies on this exact signature):
  ```ts
  interface Props {
    prefs: HearthDisplayPrefs;
    /** Render the KithLedger row (features query resolved to kithledger: true). */
    showKithRow: boolean;
    onChange: (patch: Partial<HearthDisplayPrefs>) => void;
    onClose: () => void;
  }
  export default function DisplayPrefsModal(props: Props): JSX.Element;
  ```

- [ ] **Step 1: Add the i18n strings**

`en.json`, inside `"hearth"`, after the `"kith"` line:

```json
"display": {
  "button": "Display",
  "title": "Display settings",
  "close": "Close",
  "rows": {
    "reminders": "Reminders",
    "tasks": "Tasks",
    "meals": "Meals & supper",
    "footer": "Sync status"
  }
},
```

`de.json`, same position:

```json
"display": {
  "button": "Anzeige",
  "title": "Anzeige-Einstellungen",
  "close": "Schließen",
  "rows": {
    "reminders": "Erinnerungen",
    "tasks": "Aufgaben",
    "meals": "Mahlzeiten & Abendessen",
    "footer": "Sync-Status"
  }
},
```

Leave `"kith": { "toggle": ... }` in place for now — it is removed with its last usage in Task 3.

- [ ] **Step 2: Write the failing component tests**

Create `web/src/components/hearth/display-prefs-modal.test.tsx` (same setup idiom as the other hearth component tests — i18n is initialized by the web test setup, assertions use English strings):

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import DisplayPrefsModal from './display-prefs-modal';
import type { HearthDisplayPrefs } from '@/lib/hearth-prefs';

const ALL_ON: HearthDisplayPrefs = { kithReminders: true, tasks: true, meals: true, staleFooter: true };

const setup = (over: Partial<React.ComponentProps<typeof DisplayPrefsModal>> = {}) => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<DisplayPrefsModal prefs={ALL_ON} showKithRow onChange={onChange} onClose={onClose} {...over} />);
  return { onChange, onClose };
};

afterEach(cleanup);

describe('DisplayPrefsModal', () => {
  it('renders a labelled dialog with all four rows pressed ON', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Display settings' })).toBeInTheDocument();
    for (const name of ['Reminders', 'Tasks', 'Meals & supper', 'Sync status']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('omits the reminders row when showKithRow is false', () => {
    setup({ showKithRow: false });
    expect(screen.queryByRole('button', { name: 'Reminders' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument();
  });

  it('reports a single-field patch when a row is tapped', () => {
    const { onChange, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(onChange).toHaveBeenCalledWith({ tasks: false });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reflects OFF state via aria-pressed', () => {
    setup({ prefs: { ...ALL_ON, meals: false } });
    expect(screen.getByRole('button', { name: 'Meals & supper' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes via the X button', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Display settings' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a direct backdrop tap but NOT on taps inside the dialog', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('dialog', { name: 'Display settings' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('display-prefs-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the close button on open', () => {
    setup();
    expect(screen.getByLabelText('Close')).toHaveFocus();
  });

  it('traps Tab: shift-Tab from the close button wraps to the last row', () => {
    setup();
    fireEvent.keyDown(screen.getByLabelText('Close'), { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Sync status' })).toHaveFocus();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/hearth/display-prefs-modal.test.tsx`
Expected: FAIL — module `./display-prefs-modal` not found.

- [ ] **Step 4: Implement the component**

Create `web/src/components/hearth/display-prefs-modal.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HearthDisplayPrefs } from '@/lib/hearth-prefs';

interface Props {
  prefs: HearthDisplayPrefs;
  /** Render the KithLedger row (features query resolved to kithledger: true). */
  showKithRow: boolean;
  onChange: (patch: Partial<HearthDisplayPrefs>) => void;
  onClose: () => void;
}

/**
 * Small centered settings dialog for the wall: which elements the wallboard
 * shows. Unlike the full-bleed overlays this one is a quick in-and-out, so it
 * closes on Escape and direct backdrop taps (nothing half-filled to lose).
 * Focus is trapped while open and returns to the opener on close.
 */
export default function DisplayPrefsModal({ prefs, showKithRow, onChange, onClose }: Props) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus in on open, restore to the opener (Display button) on unmount.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = cardRef.current?.querySelectorAll<HTMLElement>('button');
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const rows: Array<{ key: keyof HearthDisplayPrefs; label: string }> = [
    ...(showKithRow ? [{ key: 'kithReminders' as const, label: t('hearth.display.rows.reminders') }] : []),
    { key: 'tasks', label: t('hearth.display.rows.tasks') },
    { key: 'meals', label: t('hearth.display.rows.meals') },
    { key: 'staleFooter', label: t('hearth.display.rows.footer') },
  ];

  return (
    <div
      data-testid="display-prefs-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-8"
      onClick={(e) => {
        // Direct backdrop taps only — clicks inside the card bubble up here
        // but must not close the dialog.
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hearth-display-title"
        className="w-full max-w-md rounded-2xl border border-tan bg-card p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="hearth-display-title" className="font-serif text-3xl text-ink">{t('hearth.display.title')}</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label={t('hearth.display.close')}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ember text-white"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const on = prefs[row.key];
            return (
              <li key={row.key}>
                <button
                  onClick={() => onChange({ [row.key]: !on })}
                  aria-pressed={on}
                  className={`flex w-full items-center justify-between gap-4 rounded-xl border border-tan px-5 py-4 text-lg ${on ? 'bg-ember text-white' : 'bg-parchment text-ash'}`}
                >
                  <span>{row.label}</span>
                  <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-white/90' : 'bg-tan'}`}>
                    <span className={`absolute top-1 h-5 w-5 rounded-full transition-all ${on ? 'right-1 bg-ember' : 'left-1 bg-card'}`} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/hearth/display-prefs-modal.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/hearth/display-prefs-modal.tsx web/src/components/hearth/display-prefs-modal.test.tsx web/src/i18n/locales/en.json web/src/i18n/locales/de.json
git commit -m "feat(hearth): display settings modal component with i18n strings"
```

---

### Task 3: Wire the modal into the wall

Replace the Bell toggle with the always-visible Display opener; apply all four prefs; suppress the idle dim; retire the legacy prefs API.

**Files:**
- Modify: `web/src/pages/hearth.tsx`
- Modify: `web/src/components/hearth/now-next-strip.tsx`
- Modify: `web/src/lib/hearth-prefs.ts` (delete legacy functions + key comment)
- Modify: `web/src/lib/hearth-prefs.test.ts` (delete legacy describe block)
- Modify: `web/src/i18n/locales/en.json` + `de.json` (delete `hearth.kith` entry)
- Test: `web/src/pages/hearth.test.tsx`

**Interfaces:**
- Consumes: `loadHearthDisplayPrefs` / `saveHearthDisplayPrefs` / `HearthDisplayPrefs` (Task 1); `DisplayPrefsModal` (Task 2).
- Produces: `NowNextStrip` gains two required props: `showTasks: boolean; showSupper: boolean` (Task 4's German test renders through the page, no direct dependency).

- [ ] **Step 1: Update the page tests**

In `web/src/pages/hearth.test.tsx`:

1. In the idle-dim test (`'suppresses the idle dim while the overlay is open'`) leave as-is — it covers add-event.
2. **Replace the entire `describe('HearthPage KithLedger reminders', ...)` block** with the following two blocks:

```tsx
/** Open the display modal via the header button. */
const openDisplayModal = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Display' }));
  return screen.getByRole('dialog', { name: 'Display settings' });
};

describe('HearthPage display settings modal', () => {
  it('shows the Display button even when kithledger is off, and omits the reminders row', () => {
    render(<HearthPage />);
    openDisplayModal();
    expect(screen.queryByRole('button', { name: 'Reminders' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument();
    // Feature off → the kith query stays disabled regardless of prefs.
    const [, opts] = useKithRemindersMock.mock.calls.at(-1)!;
    expect(opts?.enabled).toBe(false);
  });

  it('closes via X, backdrop, and Escape — but not via taps inside the dialog', () => {
    render(<HearthPage />);
    const dialog = openDisplayModal();
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog', { name: 'Display settings' })).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Display settings' })).toBeNull();

    openDisplayModal();
    fireEvent.click(screen.getByTestId('display-prefs-backdrop'));
    expect(screen.queryByRole('dialog', { name: 'Display settings' })).toBeNull();

    openDisplayModal();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog', { name: 'Display settings' })).toBeNull();
  });

  it('suppresses the idle dim while the modal is open', () => {
    const { container } = render(<HearthPage />);
    openDisplayModal();
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(screen.getByRole('dialog', { name: 'Display settings' })).toBeInTheDocument();
    // The modal backdrop also uses bg-ink/40 — the dim layer is the only one
    // that is pointer-events-none, so select on both classes.
    expect(container.querySelector('.pointer-events-none.bg-ink\\/40')).toBeNull();
  });

  it('tasks toggle hides task chips and removes the due-today panel, and persists', () => {
    useTasksSpy.mockReturnValue({
      data: { data: [task({ id: 't1', title: 'Bins out', dueAt: '2026-07-24T18:00:00Z' })] },
      isError: false, dataUpdatedAt: Date.parse('2026-07-24T12:00:00Z'),
    });
    render(<HearthPage />);
    expect(screen.getByText('Bins out')).toBeInTheDocument();
    expect(screen.getByText('Due today')).toBeInTheDocument();

    openDisplayModal();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));

    expect(screen.queryByText('Bins out')).toBeNull();
    expect(screen.queryByText('Due today')).toBeNull();
    expect(JSON.parse(localStorage.getItem('heorth:hearth:display')!).tasks).toBe(false);
  });

  it('meals toggle removes the tonight panel', () => {
    render(<HearthPage />);
    expect(screen.getByText('Tonight')).toBeInTheDocument();
    openDisplayModal();
    fireEvent.click(screen.getByRole('button', { name: 'Meals & supper' }));
    expect(screen.queryByText('Tonight')).toBeNull();
    expect(JSON.parse(localStorage.getItem('heorth:hearth:display')!).meals).toBe(false);
  });

  it('footer toggle hides stale notes but keeps the "as of" stamp', () => {
    // A feed that last synced far in the past → a stale note renders.
    // IMPORTANT: match the exact feed-status shape consumed by
    // deriveStaleness in web/src/lib/hearth.ts (check its parameter type and
    // the existing deriveStaleness tests in web/src/lib/hearth.test.ts and
    // copy a stale fixture from there). Approximate shape:
    useM365FeedStatusMock.mockReturnValue({
      data: [{ feedKey: 'calendar:family', lastSuccessAt: '2026-07-23T00:00:00Z', consecutiveFailures: 5, needsReauth: false }],
    });
    render(<HearthPage />);
    expect(screen.getByText(/last synced/)).toBeInTheDocument();

    openDisplayModal();
    fireEvent.click(screen.getByRole('button', { name: 'Sync status' }));

    expect(screen.queryByText(/last synced/)).toBeNull();
    expect(screen.getByText(/as of \d{2}:\d{2}/)).toBeInTheDocument();
  });
});

describe('HearthPage KithLedger reminders', () => {
  const kithOn = { data: { data: { finance: false, kithledger: true } }, isError: false };

  it('renders reminder chips when the feature is on (default prefs)', () => {
    useFeaturesMock.mockReturnValue(kithOn);
    useKithRemindersMock.mockReturnValue({
      data: {
        data: [
          reminder({ id: 'r1', dueAt: '2026-07-24T09:00:00Z', title: 'Call Nan', kind: 'generic' }),
          reminder({ id: 'r2', dueAt: '2026-07-22T00:00:00Z', title: 'Sam’s birthday', kind: 'birthday' }),
        ],
      },
      isError: false,
      dataUpdatedAt: Date.parse('2026-07-24T12:00:00Z'),
    });
    const { container } = render(<HearthPage />);
    expect(screen.getByText('Call Nan')).toBeInTheDocument();
    expect(screen.getByText('Sam’s birthday')).toBeInTheDocument();
    // Generic reminders carry a time; birthdays are date-level (no time).
    const generic = container.querySelector('[data-hearth-reminder="r1"]')!;
    expect(generic.textContent).toMatch(/\d{2}:\d{2}/);
    const birthday = container.querySelector('[data-hearth-reminder="r2"]')!;
    expect(birthday.textContent).not.toMatch(/\d{2}:\d{2}/);
    expect(generic.tagName).toBe('DIV');
  });

  it('requests reminders for the visible range with full ISO instants', () => {
    useFeaturesMock.mockReturnValue(kithOn);
    render(<HearthPage />);
    const [params, opts] = useKithRemindersMock.mock.calls.at(-1)!;
    const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
    expect(params.from).toMatch(instant);
    expect(params.to).toMatch(instant);
    expect(opts?.enabled).toBe(true);
  });

  it('toggling the reminders row off hides chips, disables the query, and persists', () => {
    useFeaturesMock.mockReturnValue(kithOn);
    useKithRemindersMock.mockReturnValue({
      data: { data: [reminder({ id: 'r1', dueAt: '2026-07-24T09:00:00Z', title: 'Call Nan' })] },
      isError: false,
      dataUpdatedAt: Date.parse('2026-07-24T12:00:00Z'),
    });
    render(<HearthPage />);
    expect(screen.getByText('Call Nan')).toBeInTheDocument();

    openDisplayModal();
    fireEvent.click(screen.getByRole('button', { name: 'Reminders' }));

    expect(screen.queryByText('Call Nan')).toBeNull();
    expect(JSON.parse(localStorage.getItem('heorth:hearth:display')!).kithReminders).toBe(false);
    const [, opts] = useKithRemindersMock.mock.calls.at(-1)!;
    expect(opts?.enabled).toBe(false);
  });

  it('starts with reminders OFF when the legacy persisted preference says so', () => {
    localStorage.setItem('heorth:hearth:show-kith-reminders', 'false');
    useFeaturesMock.mockReturnValue(kithOn);
    render(<HearthPage />);
    const [, opts] = useKithRemindersMock.mock.calls.at(-1)!;
    expect(opts?.enabled).toBe(false);
  });

  it('keeps the wall rendering when the reminders query errors (KITH_UNAVAILABLE)', () => {
    useFeaturesMock.mockReturnValue(kithOn);
    useKithRemindersMock.mockReturnValue({ data: undefined, isError: true, dataUpdatedAt: 0 });
    const { container } = render(<HearthPage />);
    expect(container.querySelectorAll('[data-hearth-day]')).toHaveLength(7);
    expect(container.querySelectorAll('[data-hearth-reminder]')).toHaveLength(0);
  });
});
```

3. Supporting mock changes at the top of the file:
   - Make `useTasksSpy` re-assignable per test: it already is a `vi.fn` — add `useTasksSpy.mockReturnValue(emptyQuery)` inside `beforeEach` (after `localStorage.clear()`), so per-test overrides reset.
   - Replace the plain m365 mock with a spy so the footer test can inject a stale feed:

```tsx
const useM365FeedStatusMock = vi.fn(() => ({ data: [] as unknown[] }));
vi.mock('@/hooks/use-m365', () => ({ useM365FeedStatus: () => useM365FeedStatusMock() }));
```

   and add `useM365FeedStatusMock.mockReturnValue({ data: [] });` to `beforeEach`.
   - Add a `task` factory next to the `reminder` factory (match the `Task` type in `web/src/lib/types.ts` — check it and fill every required field; the essential ones for the test):

```tsx
import type { KithReminder, Task } from '@/lib/types';

const task = (over: Partial<Task> & { id: string; title: string; dueAt: string }): Task => ({
  createdAt: '', updatedAt: '', description: null, status: 'open',
  assignedMemberId: null, createdByMemberId: 'm1', completedAt: null, source: 'heorth',
  ...over,
} as Task);
```

   (If the `Task` type differs, satisfy it minimally — the page only reads `id`, `title`, `status`, `dueAt`.)
   - The idle-dim selector: the modal backdrop also uses `bg-ink/40`, so the existing dim check `container.querySelector('.bg-ink\\/40')` would match the backdrop. The dim layer is the only one with `pointer-events-none` — use `container.querySelector('.pointer-events-none.bg-ink\\/40')` in the new idle test (and update the add-event idle test's selector the same way ONLY if it fails).

- [ ] **Step 2: Run page tests to verify the new ones fail**

Run: `cd web && npx vitest run src/pages/hearth.test.tsx`
Expected: FAIL — no button named 'Display'.

- [ ] **Step 3: Add NowNextStrip panel props**

In `web/src/components/hearth/now-next-strip.tsx`:

```tsx
interface Props {
  todayOccurrences: EventOccurrence[];
  supper: MealPlanEntry | null;
  dueTodayCount: number;
  nowMs: number;
  membersById: Record<string, Member>;
  recipesById: Record<string, Recipe>;
  /** Display prefs: omit the tonight / due-today panels entirely when off. */
  showSupper: boolean;
  showTasks: boolean;
}
```

Destructure the two new props and wrap the second and third `<Panel>`s:

```tsx
{showSupper && (
  <Panel icon={<UtensilsCrossed className="h-4 w-4" />} label={t('hearth.nowNext.tonight')}>
    ...existing content unchanged...
  </Panel>
)}

{showTasks && (
  <Panel icon={<ListChecks className="h-4 w-4" />} label={t('hearth.nowNext.dueToday')}>
    ...existing content unchanged...
  </Panel>
)}
```

(The panels are `flex-1`, so the remaining ones reflow automatically.)

- [ ] **Step 4: Rewire hearth.tsx**

In `web/src/pages/hearth.tsx`:

1. Imports: drop `Bell`, add `SlidersHorizontal` from `lucide-react`; add `import DisplayPrefsModal from '@/components/hearth/display-prefs-modal';`; replace the prefs import with `import { loadHearthDisplayPrefs, saveHearthDisplayPrefs } from '@/lib/hearth-prefs';`.
2. Replace the `showKithReminders` state with:

```tsx
const [displayPrefs, setDisplayPrefs] = useState(() => loadHearthDisplayPrefs());
const [displayOpen, setDisplayOpen] = useState(false);
```

3. Kith query gate and reminders derivation use `displayPrefs.kithReminders` in place of `showKithReminders` (two spots).
4. Apply tasks/meals prefs where the raw arrays are unpacked — the display layer sees empty lists, the queries keep polling:

```tsx
const allTasks = tasksQuery.data?.data ?? [];
const allEntries = planQuery.data?.data ?? [];
// Display prefs: hidden elements see empty lists; the queries keep polling
// so re-enabling is instant.
const tasks = displayPrefs.tasks ? allTasks : [];
const entries = displayPrefs.meals ? allEntries : [];
```

(Everything downstream — `days`, `todayComposition`, `dueTodayCount`, `HearthMonth`, meal-swap ops — already consumes `tasks`/`entries`, so no other change. Note the completing-ids pruning effect also reads `tasks`; an empty list simply skips pruning while hidden, which is fine — the set re-prunes when re-enabled.)
5. Replace the header Bell button (the whole `{kithEnabled && (<button ...>)}` block) with an always-visible opener:

```tsx
{/* Wallboard display settings (which elements the wall shows). */}
<button
  onClick={() => setDisplayOpen(true)}
  aria-haspopup="dialog"
  className="inline-flex items-center gap-2 rounded-xl border border-tan bg-card px-5 py-3 text-lg text-ash"
>
  <SlidersHorizontal className="h-5 w-5" aria-hidden />
  {t('hearth.display.button')}
</button>
```

6. NowNextStrip call gains `showSupper={displayPrefs.meals}` and `showTasks={displayPrefs.tasks}`.
7. Footer stale-notes span gains the pref guard:

```tsx
{displayPrefs.staleFooter && staleNotes.length > 0 && (
  <span className="truncate text-right">{staleNotes.join('   ·   ')}</span>
)}
```

8. Render the modal next to the other overlays:

```tsx
{/* Display settings modal */}
{displayOpen && (
  <DisplayPrefsModal
    prefs={displayPrefs}
    showKithRow={kithEnabled}
    onChange={(patch) => {
      setDisplayPrefs((prev) => {
        const next = { ...prev, ...patch };
        saveHearthDisplayPrefs(next);
        return next;
      });
    }}
    onClose={() => setDisplayOpen(false)}
  />
)}
```

9. Idle-dim guard becomes `{idle && !openRecipe && !addEventDate && !displayOpen && (...)}`.

- [ ] **Step 5: Retire the legacy prefs API and the old i18n key**

- In `web/src/lib/hearth-prefs.ts`: delete `loadShowKithReminders` and `saveShowKithReminders`; keep `SHOW_KITH_REMINDERS_KEY` (the migration reads it) and note in its comment that it is legacy/migration-only.
- In `web/src/lib/hearth-prefs.test.ts`: delete the `describe('show-kith-reminders preference', ...)` block and the legacy imports; keep the `KEY` constant (the migration tests use it).
- In `en.json` and `de.json`: delete the `"kith": { "toggle": ... }` line from the `hearth` object.
- Verify nothing else references them: `cd web && npx tsc --noEmit` (or `npm run build`) and grep for `loadShowKithReminders|hearth.kith.toggle` — zero hits expected outside git history.

- [ ] **Step 6: Run the affected suites**

Run: `cd web && npx vitest run src/pages/hearth.test.tsx src/lib/hearth-prefs.test.ts src/components/hearth/display-prefs-modal.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/hearth.tsx web/src/components/hearth/now-next-strip.tsx web/src/lib/hearth-prefs.ts web/src/lib/hearth-prefs.test.ts web/src/pages/hearth.test.tsx web/src/i18n/locales/en.json web/src/i18n/locales/de.json
git commit -m "feat(hearth): display settings modal toggles wallboard elements"
```

---

### Task 4: German locale test + full verification

**Files:**
- Modify: `web/src/pages/hearth.de.test.tsx`

**Interfaces:**
- Consumes: the page wiring from Task 3 and the `hearth.display.*` German strings from Task 2.
- Produces: nothing downstream.

- [ ] **Step 1: Update the German assertions**

In `web/src/pages/hearth.de.test.tsx`, the header-controls test currently asserts `screen.getByRole('button', { name: 'Erinnerungen' })`. Replace that line with the Display button plus a modal round-trip:

```tsx
expect(screen.getByRole('button', { name: 'Anzeige' })).toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: 'Anzeige' }));
expect(screen.getByRole('dialog', { name: 'Anzeige-Einstellungen' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Erinnerungen' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Aufgaben' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Mahlzeiten & Abendessen' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Sync-Status' })).toBeInTheDocument();
fireEvent.click(screen.getByLabelText('Schließen'));
```

Add `fireEvent` to the testing-library import if it isn't imported yet.

- [ ] **Step 2: Run the German suite**

Run: `cd web && npx vitest run src/pages/hearth.de.test.tsx`
Expected: PASS.

- [ ] **Step 3: Full verification**

Run: `cd web && npm test` and `cd web && npm run build` (or `npx tsc --noEmit` if there is no build-time typecheck).
Expected: entire web suite green, no type errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/hearth.de.test.tsx
git commit -m "test(hearth): assert display modal strings in German"
```
