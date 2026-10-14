// Every consumer of the household's date must wait for /household: a
// browser-zone date that goes out (or gets saved) first is wrong whenever the
// browser and the household disagree. The browser runs in UTC; the household,
// once known, lives in Pacific/Auckland.
process.env.TZ = 'UTC';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Account, Envelope, EthelAsset } from '@/lib/types';

type HouseholdStub = { data?: { data: { timezone: string } }; isError: boolean };
const loading: HouseholdStub = { data: undefined, isError: false };
const useHouseholdMock = vi.fn((): HouseholdStub => loading);
vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => useHouseholdMock(),
  useHouseholdMembers: () => ({ data: { data: [] } }),
}));

const api = vi.hoisted(() => ({
  listTasks: vi.fn(), listShoppingItems: vi.fn(), listOccurrences: vi.fn(), getImportStatus: vi.fn(),
  listRoutines: vi.fn(),
}));
vi.mock('@/api/tasks', () => ({ listTasks: api.listTasks }));
vi.mock('@/api/meals', () => ({ listShoppingItems: api.listShoppingItems }));
vi.mock('@/api/weorc', () => ({ listOccurrences: api.listOccurrences, listRoutines: api.listRoutines }));
vi.mock('@/api/feoh-import', () => ({ getImportStatus: api.getImportStatus }));

const plan = { data: undefined as unknown, isError: false, isLoading: false, refetch: vi.fn() };
vi.mock('@/hooks/use-meals', () => ({ useWeekPlan: () => plan }));
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const okList = { data: { data: [] }, isError: false, isLoading: false, refetch: vi.fn() };
vi.mock('@/hooks/use-feoh', () => ({
  useEnvelopes: () => ({ data: { data: [{ id: 'e1', name: 'Groceries' }] }, isError: false }),
  useReconcileAccount: () => mutation,
  useCreateItemCost: () => mutation,
  useTransactions: () => okList,
}));
vi.mock('@/hooks/use-ethel', () => ({ useDecommissionAsset: () => mutation }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useNavCounts } from '@/hooks/use-nav-counts';
import DueWork from '@/components/dashboard/due-work';
import SupperCard from '@/components/dashboard/supper-card';
import WeorcPage from '@/pages/weorc';
import TransactionForm from '@/components/feoh/transaction-form';
import ReconcileDialog from '@/components/feoh/reconcile-dialog';
import DecommissionDialog from '@/components/ethel/decommission-dialog';
import CompactTaskList from '@/components/tasks/compact-task-list';
import type { Task } from '@/lib/types';

const listing = (...rows: unknown[]) => ({ data: rows, meta: { total: rows.length } });
// Due Mon 27 Jul: "tomorrow" for the UTC browser (Sun 26 Jul), but the
// household (already Mon 27 Jul in Auckland) is not known yet.
const routine = {
  id: 'r1', name: 'Put the bins out', notes: null, mode: 'fixed', intervalUnit: 'week', intervalCount: 1,
  anchorDate: '2026-07-20', leadDays: 0, ownerMemberId: null, anchorAssetId: null, anchorPlaceId: null,
  active: true, nextDueOn: '2026-07-27',
  openOccurrence: {
    id: 'o1', routineId: 'r1', dueOn: '2026-07-26', status: 'due', completedAt: null, completedByMemberId: null,
    note: null, taskFeedKey: null, taskExternalId: null, projectionError: null,
  },
};

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-26T13:00:00Z'));
  vi.clearAllMocks();
  useHouseholdMock.mockReturnValue(loading);
  api.listTasks.mockResolvedValue(listing({ id: 't1', title: 'Call', dueAt: '2026-07-26T10:00:00Z', status: 'open' }));
  api.listShoppingItems.mockResolvedValue(listing());
  api.listOccurrences.mockResolvedValue(listing());
  api.getImportStatus.mockResolvedValue({ data: { pendingCount: 0 } });
  api.listRoutines.mockResolvedValue(listing(routine));
  plan.data = undefined;
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('before /household has answered', () => {
  it('useNavCounts sends no browser-dated Weorc query and counts no due tasks', async () => {
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await settle();
    expect(api.listOccurrences).not.toHaveBeenCalled();
    expect(result.current.tasks).toBeUndefined();
    expect(result.current.weorc).toBeUndefined();
  });

  it('DueWork lists no chores by a browser-zone tomorrow', async () => {
    const W = wrapper();
    render(<W><DueWork /></W>);
    await settle();
    expect(screen.queryByText('Put the bins out')).not.toBeInTheDocument();
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
  });

  it('SupperCard shows loading, not "nothing planned"', () => {
    render(<SupperCard />);
    expect(screen.queryByText('Nothing planned yet')).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('WeorcPage splits nothing into Due now/Coming up and cannot start a new routine', async () => {
    const W = wrapper();
    render(<W><WeorcPage /></W>);
    await settle();
    expect(screen.queryByTestId('due-now')).not.toBeInTheDocument();
    expect(screen.queryByTestId('coming-up')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new routine/i })).toBeDisabled();
  });

  it('the finance and asset forms offer no date and no submit yet', () => {
    render(<>
      <TransactionForm accounts={[{ id: 'a1' } as Account]} envelopes={[{ id: 'e1' } as Envelope]} onSubmit={async () => {}} onCancel={() => {}} />
      <ReconcileDialog open onOpenChange={() => {}} accountId="a1" />
      <DecommissionDialog asset={{ id: 'x1', name: 'Kettle' } as EthelAsset} onClose={() => {}} />
    </>);
    expect(screen.queryAllByLabelText(/date/i)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^save$|record|decommission/i })).not.toBeInTheDocument();
  });
});

describe('task due dates before /household has answered', () => {
  it('CompactTaskList shows no browser-zone due date', () => {
    // 21:00Z Sun 26 Jul: Sunday for the browser, Monday for the household.
    const task = { id: 't1', title: 'Bins out', dueAt: '2026-07-26T21:00:00Z', status: 'open' } as Task;
    render(<CompactTaskList tasks={[task]} onToggle={() => {}} />);
    expect(screen.getByText('Bins out')).toBeInTheDocument();
    expect(screen.queryByText(/Jul 26, 2026/)).not.toBeInTheDocument();
  });
});

describe('SupperCard once the zone is known', () => {
  it('still shows loading while the plan itself loads', () => {
    useHouseholdMock.mockReturnValue({ data: { data: { timezone: 'Pacific/Auckland' } }, isError: false });
    plan.isLoading = true;
    render(<SupperCard />);
    expect(screen.queryByText('Nothing planned yet')).not.toBeInTheDocument();
    plan.isLoading = false;
  });
});
