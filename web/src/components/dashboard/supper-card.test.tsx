import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { MealPlanEntry, Recipe } from '@/lib/types';

const zucchini: Recipe = {
  id: 'r-zucchini', createdAt: '', updatedAt: '', title: 'Zucchini bake', servings: 2,
  ingredients: [{ name: 'Zucchini', qty: 2, unit: 'pc' }], steps: ['Bake'], tags: [], createdBy: 'm1',
};
const entry = (over: Partial<MealPlanEntry>): MealPlanEntry => ({
  id: 'p1', createdAt: '', updatedAt: '', date: '2026-07-22', slot: 'supper',
  recipeId: null, freeText: null, cook: null, helper: null, ...over,
});
const query = <T,>(data: T) => ({ data: { data }, isError: false, refetch: vi.fn() });

let plan: MealPlanEntry[] = [];
vi.mock('@/hooks/use-meals', () => ({
  useWeekPlan: () => query(plan),
  // Paged list (first 20 by title): the card must not depend on it.
}));

vi.mock('@/hooks/use-household', () => ({ useHousehold: () => ({ data: { data: { timezone: 'UTC' } }, isError: false }) }));
import SupperCard from './supper-card';

afterEach(() => { cleanup(); plan = []; });

describe('SupperCard', () => {
  it("shows tonight's recipe and its ingredients even when it is not on the recipe list's first page", () => {
    plan = [entry({ recipeId: zucchini.id, recipe: zucchini })];
    render(<SupperCard />);
    expect(screen.getByText('Zucchini bake')).toBeInTheDocument();
    expect(screen.getByText('Zucchini')).toBeInTheDocument();
  });

  it('shows a free-text supper as is', () => {
    plan = [entry({ freeText: 'Leftovers', recipe: null })];
    render(<SupperCard />);
    expect(screen.getByText('Leftovers')).toBeInTheDocument();
  });
});
