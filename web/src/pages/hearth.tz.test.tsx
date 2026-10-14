// The browser runs in UTC; the household lives in Pacific/Auckland (UTC+12 in
// July). Set before any import touches Date/Intl so the gap is real on every
// runner, not an accident of the machine's zone.
process.env.TZ = 'UTC';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import type { EventOccurrence, Task } from '@/lib/types';

const HOUSEHOLD_TZ = 'Pacific/Auckland';
const stub = <T,>(data: T) => ({ data: { data }, isError: false, dataUpdatedAt: 0 });

const useEventsSpy = vi.fn((_p: { from: string; to: string }, _o?: unknown) => stub([] as EventOccurrence[]));
vi.mock('@/hooks/use-calendar', () => ({
  useEvents: (...a: Parameters<typeof useEventsSpy>) => useEventsSpy(...a),
  useCreateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
const useTasksSpy = vi.fn((_p: { due_from: string; due_to: string }, _o?: unknown) => stub([] as Task[]));
vi.mock('@/hooks/use-tasks', () => ({
  useTasks: (...a: Parameters<typeof useTasksSpy>) => useTasksSpy(...a),
  useCompleteTask: () => ({ mutateAsync: vi.fn() }),
}));
const useWeekPlanSpy = vi.fn((_from: string, _to: string, _o?: unknown) => stub([]));
vi.mock('@/hooks/use-meals', () => ({
  useWeekPlan: (...a: Parameters<typeof useWeekPlanSpy>) => useWeekPlanSpy(...a),
  useUpsertPlanEntry: () => ({ mutateAsync: vi.fn() }),
  useDeletePlanEntry: () => ({ mutateAsync: vi.fn() }),
}));
type HouseholdStub = { data?: { data: { timezone: string } }; isError: boolean };
const loaded: HouseholdStub = { data: { data: { timezone: HOUSEHOLD_TZ } }, isError: false };
const useHouseholdMock = vi.fn((): HouseholdStub => loaded);
vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => useHouseholdMock(),
  useHouseholdMembers: () => stub([]),
}));
vi.mock('@/hooks/use-m365', () => ({ useIntegrationsFeedStatus: () => ({ data: [] }) }));
vi.mock('@/hooks/use-features', () => ({
  useFeatures: () => ({ data: { data: { finance: false, kithledger: false } }, isError: false }),
}));
vi.mock('@/hooks/use-kith', () => ({ useKithReminders: () => stub([]) }));

import HearthPage from './hearth';

const occurrence = (id: string, title: string, at: string): EventOccurrence => ({
  id, createdAt: '', updatedAt: '', title, startAt: at, endAt: at, allDay: false,
  location: null, notes: null, category: null, color: null, createdBy: '', recurrence: null,
  attendeeIds: [], occurrenceStart: at,
});

const todayColumn = (c: HTMLElement) => c.querySelector('[aria-current="date"]')?.getAttribute('data-hearth-day');
const lastCall = <A extends unknown[]>(spy: { mock: { calls: A[] } }) => spy.mock.calls[spy.mock.calls.length - 1]!;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useEventsSpy.mockClear();
  useTasksSpy.mockClear();
  useWeekPlanSpy.mockClear();
  useHouseholdMock.mockReturnValue(loaded);
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('HearthPage in the household time zone', () => {
  // 13:00Z on Sun 26 Jul is 01:00 on Mon 27 Jul in Auckland: the browser is
  // still in the week of 20-26 Jul, the household has started 27 Jul-2 Aug.
  const NOW = '2026-07-26T13:00:00Z';

  it("shows the household's date as today and fetches the household's week", () => {
    vi.setSystemTime(new Date(NOW));
    const { container } = render(<HearthPage />);

    const cols = [...container.querySelectorAll('[data-hearth-day]')].map((e) => e.getAttribute('data-hearth-day'));
    expect(cols[0]).toBe('2026-07-27');
    expect(cols[6]).toBe('2026-08-02');
    expect(todayColumn(container)).toBe('2026-07-27');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monday');
    expect(screen.getByText(/Jul 27.*Aug 2/)).toBeInTheDocument();

    // Instant windows bracket the household week: Mon 00:00 → Sun 23:59:59.999 NZST.
    const [tasksWindow] = lastCall(useTasksSpy);
    expect(tasksWindow).toEqual({ due_from: '2026-07-26T12:00:00.000Z', due_to: '2026-08-02T11:59:59.999Z' });
    expect(lastCall(useEventsSpy)[0]).toEqual({ from: '2026-07-26T12:00:00.000Z', to: '2026-08-02T11:59:59.999Z' });
    // The meal plan is keyed by date: the household's dates.
    expect(lastCall(useWeekPlanSpy).slice(0, 2)).toEqual(['2026-07-27', '2026-08-02']);
  });

  it("buckets events into household days and shows household times in now/next", () => {
    vi.setSystemTime(new Date(NOW));
    // 20:00Z Sun = 08:00 Mon in Auckland (but 20:00 Sun in the browser).
    useEventsSpy.mockReturnValue(stub([occurrence('e1', 'School run', '2026-07-26T20:00:00Z')]));
    const { container } = render(<HearthPage />);

    const monday = container.querySelector('[data-hearth-day="2026-07-27"]') as HTMLElement;
    expect(within(monday).getByText('School run')).toBeInTheDocument();
    expect(within(monday).getByText('8:00 AM')).toBeInTheDocument();
    // The now/next strip reads "today" in the household zone too.
    expect(screen.getByText('Up next').parentElement!.parentElement).toHaveTextContent('8:00 AMSchool run');
  });

  it('rolls over at household midnight while the wall stays open', () => {
    // 11:59Z Sun 26 Jul = 23:59 Sun in Auckland: still the week of 20-26 Jul.
    vi.setSystemTime(new Date('2026-07-26T11:59:00Z'));
    const { container } = render(<HearthPage />);
    expect(todayColumn(container)).toBe('2026-07-26');
    expect(lastCall(useWeekPlanSpy).slice(0, 2)).toEqual(['2026-07-20', '2026-07-26']);

    act(() => { vi.advanceTimersByTime(60_000); });

    expect(todayColumn(container)).toBe('2026-07-27');
    expect(lastCall(useWeekPlanSpy).slice(0, 2)).toEqual(['2026-07-27', '2026-08-02']);
  });
});

describe('HearthPage before the household zone is known', () => {
  const enabledOf = (opts: unknown) => (opts as { enabled?: boolean } | undefined)?.enabled;

  it('fetches nothing date-shaped and shows no week while the household loads', () => {
    vi.setSystemTime(new Date('2026-07-26T13:00:00Z'));
    useHouseholdMock.mockReturnValue({ data: undefined, isError: false });
    const { container } = render(<HearthPage />);

    expect(container.querySelectorAll('[data-hearth-day]')).toHaveLength(0);
    // Every call so far was disabled: no browser-zone week went out.
    expect(useTasksSpy.mock.calls.every(([, o]) => enabledOf(o) === false)).toBe(true);
    expect(useEventsSpy.mock.calls.every(([, o]) => enabledOf(o) === false)).toBe(true);
    expect(useWeekPlanSpy.mock.calls.every(([, , o]) => enabledOf(o) === false)).toBe(true);
  });

  it("falls back to the browser's zone if the household cannot be loaded", () => {
    vi.setSystemTime(new Date('2026-07-26T13:00:00Z'));
    useHouseholdMock.mockReturnValue({ data: undefined, isError: true });
    const { container } = render(<HearthPage />);

    // Browser (UTC) Sunday 26 Jul: the week of 20-26 Jul, fetched.
    expect(todayColumn(container)).toBe('2026-07-26');
    expect(enabledOf(lastCall(useTasksSpy)[1])).not.toBe(false);
    expect(lastCall(useTasksSpy)[0]).toEqual({ due_from: '2026-07-20T00:00:00.000Z', due_to: '2026-07-26T23:59:59.999Z' });
  });
});
