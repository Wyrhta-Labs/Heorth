### Task 4.4: Meals MCP tools

**Files:**
- Modify: `src/modules/meals/mcp.ts`
- Test: `tests/meals-mcp.test.ts`

**Interfaces:**
- Produces: `mealsTools` — `meals.list_recipes`, `meals.create_recipe`, `meals.plan_meal`, `meals.get_week_plan`, `meals.generate_shopping_list`, `meals.check_off_item`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/meals-mcp.test.ts
import { describe, it, expect } from 'vitest';
import { seedTestHousehold, invokeTool } from './helpers.js';
import { mealsTools } from '../src/modules/meals/mcp.js';

describe('meals MCP tools', () => {
  it('creates a recipe, plans it, and generates a shopping list', async () => {
    const { admin } = await seedTestHousehold();
    const recipe = await invokeTool(mealsTools, 'meals.create_recipe',
      { userId: admin.user.id, role: 'admin' },
      { title: 'Tacos', servings: 4, ingredients: [{ name: 'Tortillas', qty: 8, unit: 'each' }], steps: [], tags: [] }) as { id: string };

    await invokeTool(mealsTools, 'meals.plan_meal',
      { userId: admin.user.id, role: 'admin' },
      { date: '2026-07-15', slot: 'supper', recipeId: recipe.id });

    const list = await invokeTool(mealsTools, 'meals.generate_shopping_list',
      { userId: admin.user.id, role: 'admin' },
      { from: '2026-07-13', to: '2026-07-19' }) as { items: Array<{ name: string }> };
    expect(list.items.some((i) => i.name === 'Tortillas')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/meals-mcp.test.ts`
Expected: FAIL — tools empty.

- [ ] **Step 3: Replace `src/modules/meals/mcp.ts`**

```ts
import { z } from 'zod';
import type { McpTool } from '@wyrhta/core/mcp';
import * as service from './service.js';
import { MEAL_SLOTS } from './schema.js';

export const mealsTools: McpTool[] = [
  {
    name: 'meals.list_recipes',
    description: 'List recipes, optionally filtered by tag.',
    inputSchema: z.object({ tag: z.string().optional(), limit: z.number().int().positive().max(100).optional() }),
    async handler(_ctx, input) {
      const i = input as { tag?: string; limit?: number };
      const { rows } = await service.listRecipes(i);
      return { recipes: rows };
    },
  },
  {
    name: 'meals.create_recipe',
    description: 'Create a recipe with ingredients, steps, and tags.',
    inputSchema: z.object({
      title: z.string().min(1),
      servings: z.number().int().positive().default(1),
      ingredients: z.array(z.object({ name: z.string(), qty: z.number(), unit: z.string() })).default([]),
      steps: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
    }),
    async handler(ctx, input) {
      return service.createRecipe(input as never, ctx.userId);
    },
  },
  {
    name: 'meals.plan_meal',
    description: 'Assign a recipe or free-text meal to a date + slot (upserts).',
    inputSchema: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      slot: z.enum(MEAL_SLOTS),
      recipeId: z.string().uuid().nullish(),
      freeText: z.string().nullish(),
      cook: z.string().uuid().nullish(),
      helper: z.string().uuid().nullish(),
    }),
    async handler(_ctx, input) {
      return service.upsertPlanEntry(input as never);
    },
  },
  {
    name: 'meals.get_week_plan',
    description: 'Return meal plan entries between two dates (YYYY-MM-DD).',
    inputSchema: z.object({ from: z.string(), to: z.string() }),
    async handler(_ctx, input) {
      const i = input as { from: string; to: string };
      const entries = await service.getWeekPlan(i.from, i.to);
      return { entries };
    },
  },
  {
    name: 'meals.generate_shopping_list',
    description: 'Generate (regenerate) the shopping list from planned recipes in a date range.',
    inputSchema: z.object({ from: z.string(), to: z.string() }),
    async handler(_ctx, input) {
      const i = input as { from: string; to: string };
      const items = await service.generateShoppingList(i.from, i.to);
      return { items };
    },
  },
  {
    name: 'meals.check_off_item',
    description: 'Mark a shopping list item as checked or unchecked.',
    inputSchema: z.object({ id: z.string().uuid(), checked: z.boolean().default(true) }),
    async handler(_ctx, input) {
      const i = input as { id: string; checked: boolean };
      const item = await service.updateShoppingItem(i.id, { checked: i.checked });
      if (!item) throw new Error('Item not found');
      return item;
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/meals-mcp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/meals/mcp.ts tests/meals-mcp.test.ts
git commit -m "feat: add meals MCP tools"
```

---

