import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { format } from 'date-fns';
import type { MealPlanEntry, Recipe } from '@/lib/types';
import WeekPlanner from './week-planner';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('WeekPlanner', () => {
  it("labels a planned recipe from the entry, not from the paged recipe list", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-22T12:00:00'));
    const zucchini: Recipe = {
      id: 'r-zucchini', createdAt: '', updatedAt: '', title: 'Zucchini bake', servings: 2,
      ingredients: [], steps: [], tags: [], createdBy: 'm1',
    };
    const entries: MealPlanEntry[] = [{
      id: 'p1', createdAt: '', updatedAt: '', date: format(new Date(), 'yyyy-MM-dd'), slot: 'supper',
      recipeId: zucchini.id, freeText: null, cook: null, helper: null, recipe: zucchini,
    }];
    render(<WeekPlanner entries={entries} onAssign={() => {}} />);
    expect(screen.getByRole('button', { name: 'Zucchini bake' })).toBeInTheDocument();
  });
});
