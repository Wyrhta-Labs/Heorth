import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '../../wiring.js';
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
