import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ListResponse, Recipe } from '@/lib/types';

const listRecipes = vi.fn();
vi.mock('@/api/meals', () => ({ listRecipes: (...a: unknown[]) => listRecipes(...a) }));

import { useRecipePages } from '@/hooks/use-meals';
import RecipeLibrary from './recipe-library';

const recipe = (n: number): Recipe => ({
  id: `r${n}`, createdAt: '', updatedAt: '', title: `Recipe ${String(n).padStart(2, '0')}`, servings: 2,
  ingredients: [], steps: [], tags: [], createdBy: 'm1',
});
const ALL = Array.from({ length: 25 }, (_, i) => recipe(i + 1));
const serverPage = (limit: number, offset: number): ListResponse<Recipe> => ({
  data: ALL.slice(offset, offset + limit), meta: { total: ALL.length, limit, offset },
});

function Harness() {
  const q = useRecipePages('');
  return (
    <RecipeLibrary
      recipes={q.data?.recipes ?? []} onSelect={() => {}}
      hasMore={!!q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => q.fetchNextPage()}
    />
  );
}
const renderHarness = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Harness /></QueryClientProvider>,
);

beforeEach(() => {
  listRecipes.mockReset();
  listRecipes.mockImplementation(async (p: { limit: number; offset: number }) => serverPage(p.limit, p.offset));
});
afterEach(() => cleanup());

describe('RecipeLibrary paging', () => {
  it('appends the next page on "Load more" and hides the button at the end', async () => {
    const user = userEvent.setup();
    renderHarness();

    expect(await screen.findByText('Recipe 20')).toBeInTheDocument();
    expect(screen.queryByText('Recipe 21')).not.toBeInTheDocument();
    expect(listRecipes).toHaveBeenLastCalledWith({ q: undefined, limit: 20, offset: 0 });

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Recipe 25')).toBeInTheDocument();
    expect(screen.getByText('Recipe 01')).toBeInTheDocument();
    expect(listRecipes).toHaveBeenLastCalledWith({ q: undefined, limit: 20, offset: 20 });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument());
  });

  it('shows no "Load more" when everything fits on the first page', () => {
    render(<RecipeLibrary recipes={ALL.slice(0, 3)} onSelect={() => {}} hasMore={false} onLoadMore={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});
