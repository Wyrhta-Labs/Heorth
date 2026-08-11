import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// Stub all data hooks so the page renders deterministically without a network.
const emptyQuery = { data: { data: [] }, isError: false, dataUpdatedAt: Date.parse('2026-07-24T12:00:00Z') };
const createEventSpy = vi.fn();
vi.mock('@/hooks/use-calendar', () => ({
  useEvents: () => emptyQuery,
  useCreateEvent: () => ({ mutateAsync: createEventSpy, isPending: false }),
}));
type TaskQueryStub = { data?: { data: Task[] }; isError: boolean; dataUpdatedAt: number };
const useTasksSpy = vi.fn(
  (_params: { due_from: string; due_to: string }, _opts?: unknown): TaskQueryStub => emptyQuery,
);
vi.mock('@/hooks/use-tasks', () => ({
  useTasks: (...args: Parameters<typeof useTasksSpy>) => useTasksSpy(...args),
  useCompleteTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/use-meals', () => ({
  useWeekPlan: () => emptyQuery,
  useRecipes: () => emptyQuery,
  useUpsertPlanEntry: () => ({ mutateAsync: vi.fn() }),
  useDeletePlanEntry: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/use-household', () => ({ useHouseholdMembers: () => emptyQuery }));
const useM365FeedStatusMock = vi.fn(() => ({ data: [] as unknown[] }));
vi.mock('@/hooks/use-m365', () => ({ useM365FeedStatus: () => useM365FeedStatusMock() }));
const useFeaturesMock = vi.fn();
vi.mock('@/hooks/use-features', () => ({ useFeatures: () => useFeaturesMock() }));
type KithQueryStub = { data?: { data: KithReminder[] }; isError: boolean; dataUpdatedAt: number };
const useKithRemindersMock = vi.fn(
  (_params: { from: string; to: string }, _opts?: { enabled?: boolean }): KithQueryStub => emptyQuery,
);
vi.mock('@/hooks/use-kith', () => ({
  useKithReminders: (...args: Parameters<typeof useKithRemindersMock>) => useKithRemindersMock(...args),
}));

import HearthPage from './hearth';
import type { KithReminder, Task } from '@/lib/types';

const reminder = (over: Partial<KithReminder> & { id: string; dueAt: string }): KithReminder => ({
  createdAt: '', updatedAt: '', personId: 'p1', title: 'Reminder', notes: null,
  status: 'pending', snoozedUntil: null, recurrence: null, kind: 'generic', leadDays: 0,
  ...over,
});

const task = (over: Partial<Task> & { id: string; title: string; dueAt: string }): Task => ({
  source: 'todo', feedKey: 'todo:member:m1:L1', externalId: 'e1', memberId: 'm1',
  listId: 'L1', listName: null, notes: null, completedAt: null, status: 'open',
  createdAt: '', updatedAt: '', syncedAt: '',
  ...over,
} as Task);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-24T12:00:00Z'));
  localStorage.clear();
  useFeaturesMock.mockReturnValue({ data: { data: { finance: false, kithledger: false } }, isError: false });
  useKithRemindersMock.mockReturnValue(emptyQuery);
  useTasksSpy.mockReturnValue(emptyQuery);
  useM365FeedStatusMock.mockReturnValue({ data: [] });
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('HearthPage view + paging', () => {
  it('defaults to the week view with seven day columns', () => {
    const { container } = render(<HearthPage />);
    expect(container.querySelectorAll('[data-hearth-day]')).toHaveLength(7);
  });

  it('switches to the month view when the toggle is tapped', () => {
    const { container } = render(<HearthPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    // Month grid has no draggable day columns; it shows weekday headers instead.
    expect(container.querySelectorAll('[data-hearth-day]')).toHaveLength(0);
    expect(screen.getByText('Sun')).toBeInTheDocument();
  });

  it('reveals a "back to today" control once paged off the current week', () => {
    render(<HearthPage />);
    expect(screen.queryByLabelText('Back to today')).toBeNull();
    fireEvent.click(screen.getByLabelText('Next'));
    expect(screen.getByLabelText('Back to today')).toBeInTheDocument();
  });

  it('queries tasks with full ISO instants, not date-only values (#3)', () => {
    // The server validator (src/modules/tasks/validators.ts) requires
    // z.string().datetime() — a date-only yyyy-MM-dd 400s on every poll.
    render(<HearthPage />);
    const [params] = useTasksSpy.mock.calls[0];
    const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
    expect(params.due_from).toMatch(instant);
    expect(params.due_to).toMatch(instant);
    // Local week boundaries (Mon 00:00 → Sun 23:59:59.999 local), same
    // local-day bucketing convention as the display side (lib/hearth.ts isoOf).
    expect(new Date(params.due_from).getTime()).toBe(new Date('2026-07-20T00:00:00').getTime());
    expect(new Date(params.due_to).getTime()).toBe(new Date('2026-07-26T23:59:59.999').getTime());
  });

  it('shows the freshness "as of" stamp', () => {
    render(<HearthPage />);
    expect(screen.getByText(/as of \d{2}:\d{2}/)).toBeInTheDocument();
  });
});

describe('HearthPage add-event overlay', () => {
  it('opens the overlay pre-filled with the tapped week day', () => {
    const { container } = render(<HearthPage />);

    fireEvent.click(container.querySelector('[data-hearth-day="2026-07-20"]')!);

    expect(screen.getByRole('dialog', { name: 'Add event' })).toBeInTheDocument();
    // 2026-07-20 is not "today" (frozen at 2026-07-24) → default morning slot.
    expect(screen.getByLabelText('Start *')).toHaveValue('2026-07-20T09:00');
  });

  it('suppresses the idle dim while the overlay is open', () => {
    const { container } = render(<HearthPage />);
    fireEvent.click(container.querySelector('[data-hearth-day="2026-07-20"]')!);
    // Let useIdle's inactivity timer fire while the form is open: the dim
    // layer must stay away so it never shades a half-filled form.
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(screen.getByRole('dialog', { name: 'Add event' })).toBeInTheDocument();
    expect(container.querySelector('.bg-ink\\/40')).toBeNull();
  });

  it('closes only via the big X — not via Escape', () => {
    const { container } = render(<HearthPage />);
    fireEvent.click(container.querySelector('[data-hearth-day="2026-07-20"]')!);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Add event' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog', { name: 'Add event' })).toBeNull();
  });

  it('opens the overlay from a month cell tap', () => {
    const { container } = render(<HearthPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));

    fireEvent.click(container.querySelector('[data-hearth-month-day="2026-07-08"]')!);

    expect(screen.getByRole('dialog', { name: 'Add event' })).toBeInTheDocument();
    expect(screen.getByLabelText('Start *')).toHaveValue('2026-07-08T09:00');
  });
});

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
    useM365FeedStatusMock.mockReturnValue({
      data: [{
        feedKey: 'calendar:family', lastSuccessAt: '2026-07-23T00:00:00Z',
        lastError: null, consecutiveFailures: 5, updatedAt: '2026-07-24T12:00:00Z',
      }],
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
