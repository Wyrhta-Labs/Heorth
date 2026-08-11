import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// Stub all data hooks so the page renders deterministically without a network.
const emptyQuery = { data: { data: [] }, isError: false, dataUpdatedAt: Date.parse('2026-07-24T12:00:00Z') };
const createEventSpy = vi.fn();
vi.mock('@/hooks/use-calendar', () => ({
  useEvents: () => emptyQuery,
  useCreateEvent: () => ({ mutateAsync: createEventSpy, isPending: false }),
}));
const useTasksSpy = vi.fn((_params: { due_from: string; due_to: string }, _opts?: unknown) => emptyQuery);
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
vi.mock('@/hooks/use-m365', () => ({ useM365FeedStatus: () => ({ data: [] }) }));
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
import type { KithReminder } from '@/lib/types';

const reminder = (over: Partial<KithReminder> & { id: string; dueAt: string }): KithReminder => ({
  createdAt: '', updatedAt: '', personId: 'p1', title: 'Reminder', notes: null,
  status: 'pending', snoozedUntil: null, recurrence: null, kind: 'generic', leadDays: 0,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-24T12:00:00Z'));
  localStorage.clear();
  useFeaturesMock.mockReturnValue({ data: { data: { finance: false, kithledger: false } }, isError: false });
  useKithRemindersMock.mockReturnValue(emptyQuery);
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

describe('HearthPage KithLedger reminders', () => {
  const kithOn = { data: { data: { finance: false, kithledger: true } }, isError: false };

  it('hides the toggle entirely when the kithledger feature is off', () => {
    render(<HearthPage />);
    expect(screen.queryByRole('button', { name: 'Reminders' })).toBeNull();
    // And the query is disabled — the feature being off must not poll.
    const [, opts] = useKithRemindersMock.mock.calls.at(-1)!;
    expect(opts?.enabled).toBe(false);
  });

  it('shows the toggle (default ON) and renders reminder chips when the feature is on', () => {
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
    const toggle = screen.getByRole('button', { name: 'Reminders' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Call Nan')).toBeInTheDocument();
    expect(screen.getByText('Sam’s birthday')).toBeInTheDocument();
    // Generic reminders carry a time; birthdays are date-level (no time).
    const generic = container.querySelector('[data-hearth-reminder="r1"]')!;
    expect(generic.textContent).toMatch(/\d{2}:\d{2}/);
    const birthday = container.querySelector('[data-hearth-reminder="r2"]')!;
    expect(birthday.textContent).not.toMatch(/\d{2}:\d{2}/);
    // Read-only: reminder chips are not buttons.
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

  it('toggling off hides the chips, disables the query, and persists', () => {
    useFeaturesMock.mockReturnValue(kithOn);
    useKithRemindersMock.mockReturnValue({
      data: { data: [reminder({ id: 'r1', dueAt: '2026-07-24T09:00:00Z', title: 'Call Nan' })] },
      isError: false,
      dataUpdatedAt: Date.parse('2026-07-24T12:00:00Z'),
    });
    render(<HearthPage />);
    expect(screen.getByText('Call Nan')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reminders' }));

    expect(screen.queryByText('Call Nan')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reminders' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('heorth:hearth:show-kith-reminders')).toBe('false');
    const [, opts] = useKithRemindersMock.mock.calls.at(-1)!;
    expect(opts?.enabled).toBe(false);
  });

  it('starts OFF when the persisted preference says so', () => {
    localStorage.setItem('heorth:hearth:show-kith-reminders', 'false');
    useFeaturesMock.mockReturnValue(kithOn);
    render(<HearthPage />);
    expect(screen.getByRole('button', { name: 'Reminders' })).toHaveAttribute('aria-pressed', 'false');
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
