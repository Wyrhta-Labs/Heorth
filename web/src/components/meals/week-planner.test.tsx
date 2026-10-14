import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { weekOfIso } from '@/lib/format';
import type { MealPlanEntry, Recipe } from '@/lib/types';
import WeekPlanner from './week-planner';

afterEach(() => { cleanup(); });

describe('WeekPlanner', () => {
  it("labels a planned recipe from the entry, not from the paged recipe list", () => {
    const zucchini: Recipe = {
      id: 'r-zucchini', createdAt: '', updatedAt: '', title: 'Zucchini bake', servings: 2,
      ingredients: [], steps: [], tags: [], createdBy: 'm1',
    };
    const entries: MealPlanEntry[] = [{
      id: 'p1', createdAt: '', updatedAt: '', date: '2026-07-22', slot: 'supper',
      recipeId: zucchini.id, freeText: null, cook: null, helper: null, recipe: zucchini,
    }];
    render(<WeekPlanner days={weekOfIso('2026-07-22')} entries={entries} onAssign={() => {}} />);
    expect(screen.getByRole('button', { name: 'Zucchini bake' })).toBeInTheDocument();
  });
});
