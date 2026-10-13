import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { countDueTasks, useNavCounts } from './use-nav-counts';
import type { Task } from '@/lib/types';

const api = vi.hoisted(() => ({
  listTasks: vi.fn(), listShoppingItems: vi.fn(), listOccurrences: vi.fn(), getImportStatus: vi.fn(),
}));
vi.mock('@/api/tasks', () => ({ listTasks: api.listTasks }));
vi.mock('@/api/meals', () => ({ listShoppingItems: api.listShoppingItems }));
vi.mock('@/api/weorc', () => ({ listOccurrences: api.listOccurrences }));
vi.mock('@/api/feoh-import', () => ({ getImportStatus: api.getImportStatus }));
vi.mock('@/hooks/use-household', () => ({ useHousehold: () => ({ data: { data: { timezone: 'Pacific/Auckland' } } }) }));
const toast = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const task = (dueAt: string | null): Task => ({ id: dueAt ?? 'none', dueAt, status: 'open' } as Task);

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('countDueTasks', () => {
  // 2026-10-13 23:30 in Auckland (UTC+13) is 2026-10-13T10:30Z; "now" is noon there.
  const now = new Date('2026-10-12T23:00:00Z'); // 2026-10-13 12:00 Auckland
  it('counts by the household date, not UTC', () => {
    expect(countDueTasks([
      task('2026-10-13T10:30:00Z'), // 23:30 today in Auckland -> due
      task('2026-10-13T11:30:00Z'), // 00:30 tomorrow in Auckland -> not yet
      task('2026-10-01T09:00:00Z'), // overdue -> due
      task(null),                   // no due date -> not counted
    ], 'Pacific/Auckland', now)).toBe(2);
  });
});

describe('useNavCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listTasks.mockResolvedValue({ data: [task('2000-01-01T00:00:00Z')], meta: { total: 1 } });
    api.listShoppingItems.mockResolvedValue({ data: [{ checked: false }, { checked: true }, { checked: false }], meta: { total: 3 } });
    api.listOccurrences.mockResolvedValue({ data: [], meta: { total: 5 } });
    api.getImportStatus.mockResolvedValue({ data: { pendingCount: 7 } });
  });

  it('reads each count from its source', async () => {
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toEqual({ tasks: 1, shopping: 2, weorc: 5, feoh: 7 }));
    expect(api.listTasks).toHaveBeenCalledWith({ status: 'open' });
    expect(api.listOccurrences).toHaveBeenCalledWith({ status: 'due', due_to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('refreshes the Weorc badge when a Weorc mutation invalidates the routines prefix', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrap });
    await waitFor(() => expect(result.current.weorc).toBe(5));
    api.listOccurrences.mockResolvedValue({ data: [], meta: { total: 4 } });
    await qc.invalidateQueries({ queryKey: ['weorc', 'routines'] });   // what the Weorc page and DueWork do
    await waitFor(() => expect(result.current.weorc).toBe(4));
  });

  it('a failing source yields undefined, no toast, others unaffected', async () => {
    api.getImportStatus.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.tasks).toBe(1));
    await waitFor(() => expect(api.getImportStatus).toHaveBeenCalled());
    expect(result.current.feoh).toBeUndefined();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('useNavCounts across household midnight', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('rolls the Weorc due_to and the task count over without a reload', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z')); // 23:00 on 13 Oct in Auckland
    api.listTasks.mockResolvedValue({ data: [task('2026-10-14T10:30:00Z')], meta: { total: 1 } }); // 23:30 on 14 Oct
    api.listShoppingItems.mockResolvedValue({ data: [], meta: { total: 0 } });
    api.listOccurrences.mockResolvedValue({ data: [], meta: { total: 5 } });
    api.getImportStatus.mockResolvedValue({ data: { pendingCount: 0 } });

    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await vi.waitFor(() => expect(result.current.tasks).toBe(0));
    expect(api.listOccurrences).toHaveBeenLastCalledWith({ status: 'due', due_to: '2026-10-13' });

    await act(async () => {
      vi.setSystemTime(new Date('2026-10-13T11:05:00Z')); // 00:05 on 14 Oct in Auckland
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await vi.waitFor(() => expect(api.listOccurrences).toHaveBeenLastCalledWith({ status: 'due', due_to: '2026-10-14' }));
    await vi.waitFor(() => expect(result.current.tasks).toBe(1));
  });
});
