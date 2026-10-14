// The browser runs in UTC; the household lives in Pacific/Auckland (UTC+12 in
// July). Set before any import touches Date/Intl so the gap is real on every
// runner, not an accident of the machine's zone.
process.env.TZ = 'UTC';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import type { EventOccurrence } from '@/lib/types';

const HOUSEHOLD_TZ = 'Pacific/Auckland';

const useEventsSpy = vi.fn((_p: { from: string; to: string }, _o?: unknown) => ({
  data: { data: [] as EventOccurrence[] }, isError: false, isLoading: false, refetch: vi.fn(),
}));
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
vi.mock('@/hooks/use-calendar', () => ({
  useEvents: (...a: Parameters<typeof useEventsSpy>) => useEventsSpy(...a),
  useCreateEvent: () => mutation,
  useUpdateEvent: () => mutation,
  useDeleteEvent: () => mutation,
}));
type HouseholdStub = { data?: { data: { timezone: string } }; isError: boolean };
const loaded: HouseholdStub = { data: { data: { timezone: HOUSEHOLD_TZ } }, isError: false };
const useHouseholdMock = vi.fn((): HouseholdStub => loaded);
vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => useHouseholdMock(),
  useHouseholdMembers: () => ({ data: { data: [] } }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import CalendarPage from './calendar';

const occurrence = (id: string, title: string, at: string): EventOccurrence => ({
  id, createdAt: '', updatedAt: '', title, startAt: at, endAt: at, allDay: false,
  location: null, notes: null, category: null, color: null, createdBy: '', recurrence: null,
  attendeeIds: [], occurrenceStart: at,
});
const days = (c: HTMLElement) => [...c.querySelectorAll('[data-calendar-day]')].map((e) => e.getAttribute('data-calendar-day'));
const todayCell = (c: HTMLElement) => c.querySelector('[aria-current="date"]')?.getAttribute('data-calendar-day');
const lastCall = <A extends unknown[]>(spy: { mock: { calls: A[] } }) => spy.mock.calls[spy.mock.calls.length - 1]!;
const enabledOf = (opts: unknown) => (opts as { enabled?: boolean } | undefined)?.enabled;

// 13:00Z on Sun 26 Jul is 01:00 on Mon 27 Jul in Auckland: the browser is
// still in the week of 20-26 Jul, the household has started 27 Jul-2 Aug.
const NOW = '2026-07-26T13:00:00Z';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  localStorage.clear();
  useEventsSpy.mockClear();
  useHouseholdMock.mockReturnValue(loaded);
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('CalendarPage in the household time zone', () => {
  it("shows and fetches the household's week, with the household's today marked", () => {
    const { container } = render(<CalendarPage />);

    const week = days(container);
    expect(week[0]).toBe('2026-07-27');
    expect(week[6]).toBe('2026-08-02');
    expect(todayCell(container)).toBe('2026-07-27');
    // Household Mon 00:00 → Sun 23:59:59.999 NZST.
    expect(lastCall(useEventsSpy)[0]).toEqual({ from: '2026-07-26T12:00:00.000Z', to: '2026-08-02T11:59:59.999Z' });
  });

  it('shows an event created at 09:00 household time at 09:00 on its household day', () => {
    // 21:00Z Sun = 09:00 Mon in Auckland (but 21:00 Sun in the browser).
    useEventsSpy.mockReturnValue({
      data: { data: [occurrence('e1', 'School run', '2026-07-26T21:00:00Z')] }, isError: false, isLoading: false, refetch: vi.fn(),
    });
    const { container } = render(<CalendarPage />);

    const monday = container.querySelector('[data-calendar-day="2026-07-27"]') as HTMLElement;
    expect(within(monday).getByRole('button', { name: /School run/ })).toHaveTextContent('9:00 AM School run');
  });

  it("shows and fetches the household's month grid, bucketed in household days", () => {
    // 21:00Z Fri 31 Jul = 09:00 Sat 1 Aug in Auckland.
    useEventsSpy.mockReturnValue({
      data: { data: [occurrence('e1', 'Market', '2026-07-31T21:00:00Z')] }, isError: false, isLoading: false, refetch: vi.fn(),
    });
    const { container } = render(<CalendarPage />);
    fireEvent.click(screen.getByRole('button', { name: /^month$/i }));

    const grid = days(container);
    expect(grid[0]).toBe('2026-06-29');
    expect(grid[41]).toBe('2026-08-09');
    expect(todayCell(container)).toBe('2026-07-27');
    // The whole visible grid, from household Mon 29 Jun to Sun 9 Aug.
    expect(lastCall(useEventsSpy)[0]).toEqual({ from: '2026-06-28T12:00:00.000Z', to: '2026-08-09T11:59:59.999Z' });
    const aug1 = container.querySelector('[data-calendar-day="2026-08-01"]') as HTMLElement;
    expect(within(aug1).getByText('Market')).toBeInTheDocument();
  });
});

describe('CalendarPage before the household zone is known', () => {
  it('fetches nothing date-shaped and shows no week while the household loads', () => {
    useHouseholdMock.mockReturnValue({ data: undefined, isError: false });
    const { container } = render(<CalendarPage />);

    expect(days(container)).toHaveLength(0);
    expect(useEventsSpy.mock.calls.every(([, o]) => enabledOf(o) === false)).toBe(true);
  });

  it("falls back to the browser's zone if the household cannot be loaded", () => {
    useHouseholdMock.mockReturnValue({ data: undefined, isError: true });
    const { container } = render(<CalendarPage />);

    // Browser (UTC) Sunday 26 Jul: the week of 20-26 Jul, fetched.
    expect(todayCell(container)).toBe('2026-07-26');
    expect(enabledOf(lastCall(useEventsSpy)[1])).not.toBe(false);
    expect(lastCall(useEventsSpy)[0]).toEqual({ from: '2026-07-20T00:00:00.000Z', to: '2026-07-26T23:59:59.999Z' });
  });
});
