// The browser runs in UTC; the household lives in Pacific/Auckland (UTC+12 in
// July). Set before any import touches Date/Intl.
process.env.TZ = 'UTC';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { EventOccurrence } from '@/lib/types';

const useWeekPlanSpy = vi.fn((_from: string, _to: string, _o?: unknown) => ({ data: { data: [] }, isError: false, refetch: vi.fn() }));
vi.mock('@/hooks/use-meals', () => ({
  useWeekPlan: (...a: Parameters<typeof useWeekPlanSpy>) => useWeekPlanSpy(...a),
}));
const useEventsSpy = vi.fn((_p: { from: string; to: string }, _o?: unknown) => ({
  data: { data: [] as EventOccurrence[] }, isLoading: false, isError: false, refetch: vi.fn(),
}));
vi.mock('@/hooks/use-calendar', () => ({
  useEvents: (...a: Parameters<typeof useEventsSpy>) => useEventsSpy(...a),
}));
type HouseholdStub = { data?: { data: { timezone: string } }; isError: boolean };
const loaded: HouseholdStub = { data: { data: { timezone: 'Pacific/Auckland' } }, isError: false };
const useHouseholdMock = vi.fn((): HouseholdStub => loaded);
vi.mock('@/hooks/use-household', () => ({ useHousehold: () => useHouseholdMock() }));

import SupperCard from './supper-card';
import DayStrip from './day-strip';
import Agenda from './agenda';

const lastCall = <A extends unknown[]>(spy: { mock: { calls: A[] } }) => spy.mock.calls[spy.mock.calls.length - 1]!;
const enabledOf = (opts: unknown) => (opts as { enabled?: boolean } | undefined)?.enabled;
const occurrence = (id: string, title: string, at: string): EventOccurrence => ({
  id, createdAt: '', updatedAt: '', title, startAt: at, endAt: at, allDay: false,
  location: null, notes: null, category: null, color: null, createdBy: '', recurrence: null,
  attendeeIds: [], occurrenceStart: at,
});

// 13:00Z on Sun 26 Jul is 01:00 on Mon 27 Jul in Auckland: the browser's
// today is Sunday, the household's is Monday.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-26T13:00:00Z'));
  useWeekPlanSpy.mockClear();
  useEventsSpy.mockClear();
  useHouseholdMock.mockReturnValue(loaded);
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('start page widgets in the household time zone', () => {
  it("SupperCard reads tonight's supper from the household's today", () => {
    render(<SupperCard />);
    expect(lastCall(useWeekPlanSpy).slice(0, 2)).toEqual(['2026-07-27', '2026-07-27']);
  });

  it("DayStrip starts at, and marks, the household's today", () => {
    render(<DayStrip />);
    const cells = screen.getAllByTestId('day-strip-cell');
    expect(cells[0]!.dataset.iso).toBe('2026-07-27');
    expect(cells[6]!.dataset.iso).toBe('2026-08-02');
    expect(cells[0]!.dataset.today).toBe('true');
  });

  it("Agenda fetches the household's today and shows household times", () => {
    // 21:00Z Sun = 09:00 Mon in Auckland.
    useEventsSpy.mockReturnValue({
      data: { data: [occurrence('e1', 'School run', '2026-07-26T21:00:00Z')] }, isLoading: false, isError: false, refetch: vi.fn(),
    });
    render(<Agenda />);
    expect(lastCall(useEventsSpy)[0]).toEqual({ from: '2026-07-26T12:00:00.000Z', to: '2026-07-27T11:59:59.999Z' });
    expect(screen.getByText('9:00 AM')).toBeInTheDocument();
  });

  it("Agenda's tomorrow is the household's tomorrow", () => {
    render(<Agenda offset={1} />);
    expect(lastCall(useEventsSpy)[0]).toEqual({ from: '2026-07-27T12:00:00.000Z', to: '2026-07-28T11:59:59.999Z' });
  });
});

describe('start page widgets before the household zone is known', () => {
  beforeEach(() => { useHouseholdMock.mockReturnValue({ data: undefined, isError: false }); });

  it('fetch nothing date-shaped and show no browser-zone days', () => {
    render(<><SupperCard /><DayStrip /><Agenda /></>);
    expect(useWeekPlanSpy.mock.calls.every(([, , o]) => enabledOf(o) === false)).toBe(true);
    expect(useEventsSpy.mock.calls.every(([, o]) => enabledOf(o) === false)).toBe(true);
    expect(screen.queryAllByTestId('day-strip-cell')).toHaveLength(0);
  });

  it("fall back to the browser's zone if the household cannot be loaded", () => {
    useHouseholdMock.mockReturnValue({ data: undefined, isError: true });
    render(<><SupperCard /><Agenda /></>);
    expect(lastCall(useWeekPlanSpy).slice(0, 2)).toEqual(['2026-07-26', '2026-07-26']);
    expect(lastCall(useEventsSpy)[0]).toEqual({ from: '2026-07-26T00:00:00.000Z', to: '2026-07-26T23:59:59.999Z' });
  });
});
