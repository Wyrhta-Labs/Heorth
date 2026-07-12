import { apiGet, apiPost, apiPatch, apiDelete, qs } from './client';
import type {
  SingleResponse, ListResponse, Recipe, MealPlanEntry, ShoppingListItem, Ingredient, MealSlot,
} from '@/lib/types';

export interface RecipeInput {
  title: string; servings: number; ingredients: Ingredient[]; steps: string[]; tags: string[];
}
export interface PlanEntryInput {
  date: string; slot: MealSlot; recipeId?: string | null; freeText?: string | null;
  cook?: string | null; helper?: string | null;
}
export interface ShoppingItemInput { name: string; qty?: number | null; unit?: string | null; }

export function listRecipes(params: { tag?: string; limit?: number; offset?: number } = {}): Promise<ListResponse<Recipe>> {
  return apiGet(`/recipes${qs(params)}`);
}
export function getRecipe(id: string): Promise<SingleResponse<Recipe>> {
  return apiGet(`/recipes/${id}`);
}
export function createRecipe(input: RecipeInput): Promise<SingleResponse<Recipe>> {
  return apiPost('/recipes', input);
}
export function updateRecipe(id: string, input: Partial<RecipeInput>): Promise<SingleResponse<Recipe>> {
  return apiPatch(`/recipes/${id}`, input);
}
export function deleteRecipe(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/recipes/${id}`);
}

export function getWeekPlan(from: string, to: string): Promise<ListResponse<MealPlanEntry>> {
  return apiGet(`/meals/plan${qs({ from, to })}`);
}
export function upsertPlanEntry(input: PlanEntryInput): Promise<SingleResponse<MealPlanEntry>> {
  return apiPost('/meals/plan', input);
}
export function deletePlanEntry(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/meals/plan/${id}`);
}

export function listShoppingItems(): Promise<ListResponse<ShoppingListItem>> {
  return apiGet('/meals/shopping-list');
}
export function generateShoppingList(from: string, to: string): Promise<ListResponse<ShoppingListItem>> {
  return apiPost(`/meals/shopping-list/generate${qs({ from, to })}`, {});
}
export function addShoppingItem(input: ShoppingItemInput): Promise<SingleResponse<ShoppingListItem>> {
  return apiPost('/meals/shopping-list', input);
}
export function updateShoppingItem(id: string, input: Partial<ShoppingItemInput> & { checked?: boolean }): Promise<SingleResponse<ShoppingListItem>> {
  return apiPatch(`/meals/shopping-list/${id}`, input);
}
export function removeShoppingItem(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/meals/shopping-list/${id}`);
}
