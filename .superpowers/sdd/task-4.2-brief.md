### Task 4.2: Recipes + meal-plan service, validators, routes & module registration

**Files:**
- Create: `src/modules/meals/validators.ts`, `src/modules/meals/service.ts`, `src/modules/meals/routes.ts`, `src/modules/meals/mcp.ts` (placeholder), `src/modules/meals/index.ts`
- Modify: `src/modules/index.ts`
- Test: `tests/meals-routes.test.ts`

**Interfaces:**
- Produces:
  - Validators: `createRecipeSchema`, `updateRecipeSchema`, `upsertPlanEntrySchema`, `planQuerySchema`, `addShoppingItemSchema`, `updateShoppingItemSchema`, `generateQuerySchema`.
  - Service (recipes + plan portion): `listRecipes(q)`, `getRecipe(id)`, `createRecipe(input, createdBy)`, `updateRecipe(id, input)`, `deleteRecipe(id)`, `getWeekPlan(from, to)`, `upsertPlanEntry(input)`, `deletePlanEntry(id)`.
  - `mealsModule: HeorthModule`; REST under `/api/v1/recipes` and `/api/v1/meals`.

- [ ] **Step 1: Write `src/modules/meals/validators.ts`**

```ts
import { z } from 'zod';
import { MEAL_SLOTS } from './schema.js';

const ingredientSchema = z.object({
  name: z.string().min(1),
  qty: z.number(),
  unit: z.string(),
});

export const createRecipeSchema = z.object({
  title: z.string().min(1),
  servings: z.number().int().positive().default(1),
  ingredients: z.array(ingredientSchema).default([]),
  steps: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const updateRecipeSchema = createRecipeSchema.partial();

export const upsertPlanEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  slot: z.enum(MEAL_SLOTS),
  recipeId: z.string().uuid().optional().nullable(),
  freeText: z.string().optional().nullable(),
  cook: z.string().uuid().optional().nullable(),
  helper: z.string().uuid().optional().nullable(),
});

export const planQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const generateQuerySchema = planQuerySchema;

export const addShoppingItemSchema = z.object({
  name: z.string().min(1),
  qty: z.number().optional().nullable(),
  unit: z.string().optional().nullable(),
});

export const updateShoppingItemSchema = z.object({
  name: z.string().min(1).optional(),
  qty: z.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  checked: z.boolean().optional(),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type UpsertPlanEntryInput = z.infer<typeof upsertPlanEntrySchema>;
export type AddShoppingItemInput = z.infer<typeof addShoppingItemSchema>;
export type UpdateShoppingItemInput = z.infer<typeof updateShoppingItemSchema>;
```

- [ ] **Step 2: Write `src/modules/meals/service.ts`** (recipes + plan; shopping list added in Task 4.3)

```ts
import { db } from '../../db/index.js';
import { recipes, mealPlanEntries, type Recipe } from './schema.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import type { CreateRecipeInput, UpdateRecipeInput, UpsertPlanEntryInput } from './validators.js';

export async function listRecipes(q: { limit?: number; offset?: number; tag?: string }) {
  const limit = Math.min(100, Math.max(1, q.limit ?? 20));
  const offset = Math.max(0, q.offset ?? 0);
  const where = q.tag ? sql`${q.tag} = ANY(${recipes.tags})` : undefined;
  const rows = await db.select().from(recipes).where(where).orderBy(recipes.title).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(recipes).where(where);
  return { rows, total: count, limit, offset };
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
  return row ?? null;
}

export async function createRecipe(input: CreateRecipeInput, createdBy: string) {
  const [row] = await db.insert(recipes).values({
    title: input.title, servings: input.servings,
    ingredients: input.ingredients, steps: input.steps, tags: input.tags, createdBy,
  }).returning();
  return row!;
}

export async function updateRecipe(id: string, input: UpdateRecipeInput) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch['title'] = input.title;
  if (input.servings !== undefined) patch['servings'] = input.servings;
  if (input.ingredients !== undefined) patch['ingredients'] = input.ingredients;
  if (input.steps !== undefined) patch['steps'] = input.steps;
  if (input.tags !== undefined) patch['tags'] = input.tags;
  const [row] = await db.update(recipes).set(patch).where(eq(recipes.id, id)).returning();
  return row ?? null;
}

export async function deleteRecipe(id: string) {
  const [row] = await db.delete(recipes).where(eq(recipes.id, id)).returning();
  return row ?? null;
}

export async function getWeekPlan(from: string, to: string) {
  return db.select().from(mealPlanEntries)
    .where(and(gte(mealPlanEntries.date, from), lte(mealPlanEntries.date, to)))
    .orderBy(mealPlanEntries.date);
}

export async function upsertPlanEntry(input: UpsertPlanEntryInput) {
  const [row] = await db.insert(mealPlanEntries).values({
    date: input.date, slot: input.slot,
    recipeId: input.recipeId ?? null, freeText: input.freeText ?? null,
    cook: input.cook ?? null, helper: input.helper ?? null,
  }).onConflictDoUpdate({
    target: [mealPlanEntries.date, mealPlanEntries.slot],
    set: {
      recipeId: input.recipeId ?? null, freeText: input.freeText ?? null,
      cook: input.cook ?? null, helper: input.helper ?? null, updatedAt: new Date(),
    },
  }).returning();
  return row!;
}

export async function deletePlanEntry(id: string) {
  const [row] = await db.delete(mealPlanEntries).where(eq(mealPlanEntries.id, id)).returning();
  return row ?? null;
}
```

- [ ] **Step 3: Write `src/modules/meals/routes.ts`** (shopping-list routes added in Task 4.3 — include their handlers now referencing service fns created next task; to keep this task self-contained, define only recipe + plan routes here and add shopping routes in 4.3)

```ts
import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '@wyrhta/core/auth';
import * as service from './service.js';
import { createRecipeSchema, updateRecipeSchema, upsertPlanEntrySchema, planQuerySchema } from './validators.js';

export const recipesRouter = new Hono();
recipesRouter.use('*', requireAuth);

recipesRouter.get('/', async (c) => {
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');
  const { rows, total, limit: l, offset: o } = await service.listRecipes({
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
    tag: c.req.query('tag'),
  });
  return ok(c, rows, { total, limit: l, offset: o });
});

recipesRouter.post('/', async (c) => {
  const body = createRecipeSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const recipe = await service.createRecipe(body.data, c.get('auth').userId);
  return ok(c, recipe, undefined, 201);
});

recipesRouter.get('/:id', async (c) => {
  const recipe = await service.getRecipe(c.req.param('id'));
  if (!recipe) return err(c, 'NOT_FOUND', 'Recipe not found', 404);
  return ok(c, recipe);
});

recipesRouter.patch('/:id', async (c) => {
  const body = updateRecipeSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const recipe = await service.updateRecipe(c.req.param('id'), body.data);
  if (!recipe) return err(c, 'NOT_FOUND', 'Recipe not found', 404);
  return ok(c, recipe);
});

recipesRouter.delete('/:id', async (c) => {
  const recipe = await service.deleteRecipe(c.req.param('id'));
  if (!recipe) return err(c, 'NOT_FOUND', 'Recipe not found', 404);
  return ok(c, { id: recipe.id });
});

// Mounted at /api/v1/meals — plan + (shopping-list, added in Task 4.3)
export const mealsRouter = new Hono();
mealsRouter.use('*', requireAuth);

mealsRouter.get('/plan', async (c) => {
  const q = planQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'from and to (YYYY-MM-DD) are required', 400);
  const entries = await service.getWeekPlan(q.data.from, q.data.to);
  return ok(c, entries);
});

mealsRouter.post('/plan', async (c) => {
  const body = upsertPlanEntrySchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const entry = await service.upsertPlanEntry(body.data);
  return ok(c, entry, undefined, 201);
});

mealsRouter.delete('/plan/:id', async (c) => {
  const entry = await service.deletePlanEntry(c.req.param('id'));
  if (!entry) return err(c, 'NOT_FOUND', 'Plan entry not found', 404);
  return ok(c, { id: entry.id });
});
```

- [ ] **Step 4: Write `src/modules/meals/mcp.ts` (placeholder) and `src/modules/meals/index.ts`**

`src/modules/meals/mcp.ts`:
```ts
import type { McpTool } from '@wyrhta/core/mcp';
export const mealsTools: McpTool[] = [];
```

`src/modules/meals/index.ts`:
```ts
import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { recipesRouter, mealsRouter } from './routes.js';
import { mealsTools } from './mcp.js';

export const mealsModule: HeorthModule = {
  name: 'meals',
  register(app: Hono, mcp: McpRegistry): void {
    app.route('/api/v1/recipes', recipesRouter);
    app.route('/api/v1/meals', mealsRouter);
    mcp.add(...mealsTools);
  },
};
```

- [ ] **Step 5: Register in `src/modules/index.ts`**

```ts
import type { HeorthModule } from './registry.js';
import { householdModule } from '../household/index.js';
import { calendarModule } from './calendar/index.js';
import { mealsModule } from './meals/index.js';

export const ALL_MODULES: HeorthModule[] = [
  householdModule,
  calendarModule,
  mealsModule,
];
```

- [ ] **Step 6: Write the failing test**

```ts
// tests/meals-routes.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { mealsModule } from '../src/modules/meals/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

const app = createApp([householdModule, mealsModule]);

describe('meals routes', () => {
  it('creates a recipe and lists it', async () => {
    const { admin } = await seedTestHousehold();
    const create = await app.request('/api/v1/recipes', {
      method: 'POST', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ title: 'Chili', servings: 4, ingredients: [{ name: 'Beans', qty: 2, unit: 'can' }], steps: ['Simmer'], tags: ['veg'] }),
    });
    expect(create.status).toBe(201);
    const list = await app.request('/api/v1/recipes', { headers: authHeaders(admin.jwt) });
    const body = await list.json() as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('upserts a meal plan entry idempotently by date+slot', async () => {
    const { admin } = await seedTestHousehold();
    const first = await app.request('/api/v1/meals/plan', {
      method: 'POST', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ date: '2026-07-13', slot: 'supper', freeText: 'Leftovers' }),
    });
    expect(first.status).toBe(201);
    const second = await app.request('/api/v1/meals/plan', {
      method: 'POST', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ date: '2026-07-13', slot: 'supper', freeText: 'Pizza night' }),
    });
    expect(second.status).toBe(201);

    const week = await app.request('/api/v1/meals/plan?from=2026-07-13&to=2026-07-19', { headers: authHeaders(admin.jwt) });
    const body = await week.json() as { data: Array<{ freeText: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0]!.freeText).toBe('Pizza night');
  });
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- tests/meals-routes.test.ts`
Expected: FAIL first, then PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/modules/meals tests/meals-routes.test.ts src/modules/index.ts
git commit -m "feat: add meals recipes + weekly plan (service, routes) and register module"
```

---

