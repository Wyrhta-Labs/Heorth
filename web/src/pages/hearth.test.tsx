import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Stub all data hooks so the page renders deterministically without a network.
const emptyQuery = { data: { data: [] }, isError: false, dataUpdatedAt: Date.parse('2026-07-24T12:00:00Z') };
vi.mock('@/hooks/use-calendar', () => ({ useEvents: () => emptyQuery }));
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

import HearthPage from './hearth';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-24T12:00:00Z')); });
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
