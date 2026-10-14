import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ListResponse, Recipe } from '@/lib/types';

const listRecipes = vi.fn();
vi.mock('@/api/meals', () => ({ listRecipes: (...a: unknown[]) => listRecipes(...a) }));

import RecipePicker from './recipe-picker';

const recipe = (id: string, title: string): Recipe => ({
  id, createdAt: '', updatedAt: '', title, servings: 2, ingredients: [], steps: [], tags: [], createdBy: 'm1',
});
const filler = Array.from({ length: 20 }, (_, i) => recipe(`a${i}`, `A recipe ${String(i).padStart(2, '0')}`));
const zucchini = [recipe('z1', 'Zucchini bake'), recipe('z2', 'Zucchini fritters')];

beforeEach(() => {
  listRecipes.mockReset();
  listRecipes.mockImplementation(async (p: { q?: string }): Promise<ListResponse<Recipe>> => {
    if (p.q === 'zucc') return { data: zucchini, meta: { total: 2 } };
    return { data: filler, meta: { total: 22 } };
  });
});
afterEach(() => cleanup());

const renderPicker = (onPick = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RecipePicker onPick={onPick} />
    </QueryClientProvider>,
  );
  return onPick;
};

describe('RecipePicker', () => {
  it('queries the server with the typed term (debounced) and picks a recipe from beyond the first page', async () => {
    const user = userEvent.setup();
    const onPick = renderPicker();
    expect(await screen.findByText('A recipe 00')).toBeInTheDocument();
    expect(listRecipes).toHaveBeenCalledTimes(1);

    await user.type(screen.getByRole('searchbox', { name: /search recipes/i }), 'zucc');
    // Keystrokes inside the debounce window do not hit the server.
    expect(listRecipes.mock.calls.every(([p]) => p.q === undefined)).toBe(true);

    expect(await screen.findByRole('button', { name: 'Zucchini bake' })).toBeInTheDocument();
    expect(listRecipes).toHaveBeenLastCalledWith({ q: 'zucc', limit: 20, offset: 0 });
    expect(listRecipes.mock.calls.filter(([p]) => p.q !== undefined)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Zucchini bake' }));
    expect(onPick).toHaveBeenCalledWith('z1');
  });

  it('offers "Load more" while matches remain and tells when nothing matches', async () => {
    const user = userEvent.setup();
    listRecipes.mockImplementation(async (p: { q?: string; offset: number }): Promise<ListResponse<Recipe>> => {
      if (p.q === 'zzz') return { data: [], meta: { total: 0 } };
      return p.offset === 0 ? { data: filler, meta: { total: 21 } } : { data: [recipe('b1', 'B last')], meta: { total: 21 } };
    });
    renderPicker();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('button', { name: 'B last' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument());

    await user.type(screen.getByRole('searchbox', { name: /search recipes/i }), 'zzz');
    expect(await screen.findByText(/no recipes match/i)).toBeInTheDocument();
  });

  it('does not let the previous search results be picked while a new search is loading', async () => {
    const user = userEvent.setup();
    let release!: (v: ListResponse<Recipe>) => void;
    listRecipes.mockImplementation((p: { q?: string }) => (
      p.q === 'zucc'
        ? new Promise<ListResponse<Recipe>>((res) => { release = res; })
        : Promise.resolve({ data: filler, meta: { total: 20 } })
    ));
    const onPick = renderPicker();
    const stale = await screen.findByRole('button', { name: 'A recipe 00' });

    await user.type(screen.getByRole('searchbox', { name: /search recipes/i }), 'zucc');
    await waitFor(() => expect(listRecipes).toHaveBeenCalledWith({ q: 'zucc', limit: 20, offset: 0 }));
    expect(stale).toBeDisabled();
    await user.click(stale);
    expect(onPick).not.toHaveBeenCalled();

    release({ data: zucchini, meta: { total: 2 } });
    expect(await screen.findByRole('button', { name: 'Zucchini bake' })).toBeEnabled();
  });

  it('still offers the leftovers entry', async () => {
    const user = userEvent.setup();
    const onPick = renderPicker();
    await user.click(await screen.findByRole('button', { name: /leftovers/i }));
    expect(onPick).toHaveBeenCalledWith(null, 'Leftovers');
  });
});
