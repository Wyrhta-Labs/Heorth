import { describe, it, expect } from 'vitest';
import { seedTestHousehold, invokeTool } from './helpers.js';
import { mealsTools } from '../src/modules/meals/mcp.js';

describe('meals MCP tools', () => {
  it('creates a recipe, plans it, and generates a shopping list', async () => {
    const { adult } = await seedTestHousehold();
    const recipe = await invokeTool(mealsTools, 'meals.create_recipe',
      { userId: adult.user.id, role: 'adult' },
      { title: 'Tacos', servings: 4, ingredients: [{ name: 'Tortillas', qty: 8, unit: 'each' }], steps: [], tags: [] }) as { id: string };

    await invokeTool(mealsTools, 'meals.plan_meal',
      { userId: adult.user.id, role: 'adult' },
      { date: '2026-07-15', slot: 'supper', recipeId: recipe.id });

    const list = await invokeTool(mealsTools, 'meals.generate_shopping_list',
      { userId: adult.user.id, role: 'adult' },
      { from: '2026-07-13', to: '2026-07-19' }) as { items: Array<{ name: string }> };
    expect(list.items.some((i) => i.name === 'Tortillas')).toBe(true);
  });
});
