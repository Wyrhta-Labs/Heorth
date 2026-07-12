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
