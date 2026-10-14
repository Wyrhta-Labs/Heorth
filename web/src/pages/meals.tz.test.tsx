// The browser runs in UTC; the household lives in Pacific/Auckland (UTC+12 in
// July). Set before any import touches Date/Intl.
process.env.TZ = 'UTC';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const ok = { data: { data: [] }, isError: false, refetch: vi.fn() };
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const generate = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const useWeekPlanSpy = vi.fn((_from: string, _to: string, _o?: unknown) => ok);
vi.mock('@/hooks/use-meals', () => ({
  useRecipes: () => ok,
  useWeekPlan: (...a: Parameters<typeof useWeekPlanSpy>) => useWeekPlanSpy(...a),
  useShoppingList: () => ok,
  useCreateRecipe: () => mutation,
  useUpdateRecipe: () => mutation,
  useUpsertPlanEntry: () => mutation,
  useGenerateShoppingList: () => generate,
  useAddShoppingItem: () => mutation,
  useUpdateShoppingItem: () => mutation,
  useRemoveShoppingItem: () => mutation,
}));
const offlineGenerate = vi.fn();
vi.mock('@/hooks/use-offline-shopping-list', () => ({
  useOfflineShoppingList: () => ({
    items: [], isOffline: false, dataAsOf: null, pendingCount: 0,
    toggle: vi.fn(), add: vi.fn(), remove: vi.fn(), generate: offlineGenerate,
  }),
}));
type HouseholdStub = { data?: { data: { timezone: string } }; isError: boolean };
const loaded: HouseholdStub = { data: { data: { timezone: 'Pacific/Auckland' } }, isError: false };
const useHouseholdMock = vi.fn((): HouseholdStub => loaded);
vi.mock('@/hooks/use-household', () => ({ useHousehold: () => useHouseholdMock() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import MealsPage from './meals';
import ShoppingPage from './shopping';

const lastCall = <A extends unknown[]>(spy: { mock: { calls: A[] } }) => spy.mock.calls[spy.mock.calls.length - 1]!;
const enabledOf = (opts: unknown) => (opts as { enabled?: boolean } | undefined)?.enabled;

// 13:00Z on Sun 26 Jul is 01:00 on Mon 27 Jul in Auckland: the browser is
// still in the week of 20-26 Jul, the household has started 27 Jul-2 Aug.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-26T13:00:00Z'));
  useWeekPlanSpy.mockClear();
  generate.mutate.mockClear();
  mutation.mutateAsync.mockClear();
  offlineGenerate.mockClear();
  useHouseholdMock.mockReturnValue(loaded);
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('MealsPage in the household time zone', () => {
  it("plans the household's week and sends household dates", async () => {
    render(<MealsPage />);

    expect(lastCall(useWeekPlanSpy).slice(0, 2)).toEqual(['2026-07-27', '2026-08-02']);
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent).filter(Boolean);
    expect(heads[0]).toBe('Mon 27');
    expect(heads[6]).toBe('Sun 2');

    // Planning Monday's supper writes the household's Monday.
    fireEvent.click(screen.getAllByRole('button', { name: '+' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: /leftovers/i }));
    expect(mutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-07-27' }));
  });

  it("generates the shopping list from the household's week", () => {
    render(<MealsPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /shopping/i })[0]!);
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    expect(generate.mutate).toHaveBeenCalledWith({ from: '2026-07-27', to: '2026-08-02' }, expect.anything());
  });

  it('fetches no week and shows no planner while the household loads', () => {
    useHouseholdMock.mockReturnValue({ data: undefined, isError: false });
    render(<MealsPage />);
    expect(useWeekPlanSpy.mock.calls.every(([, , o]) => enabledOf(o) === false)).toBe(true);
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
  });

  it("falls back to the browser's week if the household cannot be loaded", () => {
    useHouseholdMock.mockReturnValue({ data: undefined, isError: true });
    render(<MealsPage />);
    expect(lastCall(useWeekPlanSpy).slice(0, 2)).toEqual(['2026-07-20', '2026-07-26']);
    expect(enabledOf(lastCall(useWeekPlanSpy)[2])).not.toBe(false);
  });
});

describe('ShoppingPage in the household time zone', () => {
  it("generates the list from the household's week", () => {
    render(<ShoppingPage />);
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    expect(offlineGenerate).toHaveBeenCalledWith('2026-07-27', '2026-08-02');
  });

  it('does not generate a browser-zone week while the household loads', () => {
    useHouseholdMock.mockReturnValue({ data: undefined, isError: false });
    render(<ShoppingPage />);
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
  });
});
