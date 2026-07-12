import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/meals';

export function useRecipes(params: { tag?: string } = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.recipes, params], queryFn: () => api.listRecipes(params) });
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
export function useWeekPlan(from: string, to: string) {
  return useQuery({ queryKey: [...QUERY_KEYS.mealPlan, from, to], queryFn: () => api.getWeekPlan(from, to) });
}
export function useUpsertPlanEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.PlanEntryInput) => api.upsertPlanEntry(input),
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
