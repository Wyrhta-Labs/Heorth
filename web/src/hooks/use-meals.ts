import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/meals';

export const RECIPE_PAGE_SIZE = 20;

/**
 * The recipe list, one server page at a time (sorted by title), optionally
 * narrowed by a title search. `data.recipes` is every page loaded so far and
 * `hasNextPage` says whether the server has more. The key sits under
 * QUERY_KEYS.recipes, so recipe mutations invalidate the library and the
 * picker alike.
 */
export function useRecipePages(term = '') {
  const q = term.trim();
  return useInfiniteQuery({
    queryKey: [...QUERY_KEYS.recipes, 'paged', q],
    queryFn: ({ pageParam }) => api.listRecipes({ q: q || undefined, limit: RECIPE_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      // The next offset is the raw row count; whether more remain is judged by
      // distinct ids, since a repeated row must not make the end look reached.
      const loaded = all.reduce((n, p) => n + p.data.length, 0);
      const distinct = new Set(all.flatMap((p) => p.data.map((r) => r.id))).size;
      return last.data.length > 0 && distinct < last.meta.total ? loaded : undefined;
    },
    // The server orders by (title, id), but a recipe created between two page
    // requests can still shift the window: dedupe by id so keys stay unique.
    select: (d) => {
      const seen = new Set<string>();
      const recipes = d.pages.flatMap((p) => p.data).filter((r) => !seen.has(r.id) && !!seen.add(r.id));
      return { recipes, total: d.pages[d.pages.length - 1]?.meta.total ?? 0 };
    },
    placeholderData: keepPreviousData,
  });
}
export function useCreateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.RecipeInput) => api.createRecipe(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.recipes }),
  });
}
export function useUpdateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<api.RecipeInput> }) => api.updateRecipe(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.recipes }),
  });
}
export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRecipe(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.recipes }),
  });
}
export function useWeekPlan(from: string, to: string, opts: { refetchInterval?: number; gcTime?: number; placeholderData?: typeof keepPreviousData; enabled?: boolean } = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.mealPlan, from, to], queryFn: () => api.getWeekPlan(from, to), ...opts });
}
export function useUpsertPlanEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.PlanEntryInput) => api.upsertPlanEntry(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.mealPlan }),
  });
}
export function useDeletePlanEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePlanEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.mealPlan }),
  });
}
export function useShoppingList() {
  return useQuery({ queryKey: QUERY_KEYS.shoppingList, queryFn: () => api.listShoppingItems() });
}
export function useGenerateShoppingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => api.generateShoppingList(from, to),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.shoppingList }),
  });
}
export function useAddShoppingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.ShoppingItemInput) => api.addShoppingItem(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.shoppingList }),
  });
}
export function useUpdateShoppingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<api.ShoppingItemInput> & { checked?: boolean } }) => api.updateShoppingItem(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.shoppingList }),
  });
}
export function useRemoveShoppingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeShoppingItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.shoppingList }),
  });
}
