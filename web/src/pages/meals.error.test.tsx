import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refetch = vi.fn();
const okQuery = { data: { data: [] }, isError: false, refetch };
const erroredQuery = { data: undefined, isError: true, refetch };
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

// One of the meals queries fails; the others are fine.
vi.mock('@/hooks/use-meals', () => ({
  useRecipes: () => erroredQuery,
  useWeekPlan: () => okQuery,
  useShoppingList: () => okQuery,
  useCreateRecipe: () => mutation,
  useUpdateRecipe: () => mutation,
  useUpsertPlanEntry: () => mutation,
  useGenerateShoppingList: () => mutation,
  useAddShoppingItem: () => mutation,
  useUpdateShoppingItem: () => mutation,
  useRemoveShoppingItem: () => mutation,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import MealsPage from './meals';

describe('MealsPage error handling', () => {
  it('renders the error surface with retry instead of the (empty) planner', async () => {
    refetch.mockClear();
    const user = userEvent.setup();
    render(<MealsPage />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/couldn.t load your meals/i)).toBeInTheDocument();
    // The tab chrome is not rendered in the error state.
    expect(screen.queryByRole('button', { name: 'Planner' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
