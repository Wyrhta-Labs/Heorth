import { db } from '../../db/index.js';
import { recipes, mealPlanEntries, shoppingListItems, type Recipe, type ShoppingListItem } from './schema.js';
import { eq, and, gte, lte, sql, isNotNull, inArray } from 'drizzle-orm';
import type { CreateRecipeInput, UpdateRecipeInput, UpsertPlanEntryInput, AddShoppingItemInput, UpdateShoppingItemInput } from './validators.js';
import { assertNotMaintenanceAdmin } from '../../household/maintenance-admin.js';

export async function listRecipes(q: { limit?: number; offset?: number; tag?: string; q?: string }) {
  const limit = Math.min(100, Math.max(1, q.limit ?? 20));
  const offset = Math.max(0, q.offset ?? 0);
  const conditions = [];
  if (q.tag) conditions.push(sql`${q.tag} = ANY(${recipes.tags})`);
  if (q.q) {
    // Escape LIKE wildcards so a literal "%", "_" or backslash in the term is not
    // a wildcard; the ESCAPE clause is spelled out rather than left to Postgres'
    // default (drizzle's ilike() emits none). String.raw keeps the single backslash.
    const escaped = q.q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    conditions.push(sql`${recipes.title} ILIKE ${`%${escaped}%`} ESCAPE ${sql.raw(String.raw`'\'`)}`);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  // id breaks title ties so equal titles keep one order across paged requests.
  const rows = await db.select().from(recipes).where(where).orderBy(recipes.title, recipes.id).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(recipes).where(where);
  return { rows, total: count, limit, offset };
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
  return row ?? null;
}

export async function createRecipe(input: CreateRecipeInput, createdBy: string) {
  await assertNotMaintenanceAdmin(createdBy);
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

/**
 * Plan entries in [from, to], each carrying its full `recipe` (null for a
 * free-text entry or a deleted recipe). Clients render and open a planned
 * meal from this alone: resolving `recipeId` against GET /recipes, which is
 * paged (20 by default), silently lost every recipe past the first page.
 */
export async function getWeekPlan(from: string, to: string) {
  const rows = await db.select({ entry: mealPlanEntries, recipe: recipes }).from(mealPlanEntries)
    .leftJoin(recipes, eq(recipes.id, mealPlanEntries.recipeId))
    .where(and(gte(mealPlanEntries.date, from), lte(mealPlanEntries.date, to)))
    .orderBy(mealPlanEntries.date);
  return rows.map(({ entry, recipe }) => ({ ...entry, recipe }));
}

export async function upsertPlanEntry(input: UpsertPlanEntryInput) {
  // cook/helper are nullable — a null means "unassigned" and passes the guard.
  await assertNotMaintenanceAdmin(input.cook);
  await assertNotMaintenanceAdmin(input.helper);
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

export async function listShoppingItems(): Promise<ShoppingListItem[]> {
  return db.select().from(shoppingListItems).orderBy(shoppingListItems.checked, shoppingListItems.name);
}

/** Aggregate ingredients from planned recipes in [from,to], merging like items. */
export async function generateShoppingList(from: string, to: string): Promise<ShoppingListItem[]> {
  const entries = await db.select().from(mealPlanEntries)
    .where(and(gte(mealPlanEntries.date, from), lte(mealPlanEntries.date, to), isNotNull(mealPlanEntries.recipeId)));

  const recipeIds = [...new Set(entries.map((e) => e.recipeId!).filter(Boolean))];
  const recipeRows = recipeIds.length
    ? await db.select().from(recipes).where(inArray(recipes.id, recipeIds))
    : [];
  const byId = new Map(recipeRows.map((r) => [r.id, r]));

  const merged = new Map<string, { name: string; qty: number; unit: string | null; sourceRecipeId: string }>();
  for (const entry of entries) {
    const recipe = byId.get(entry.recipeId!);
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const unit = ing.unit ?? '';
      const key = `${ing.name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
      const existing = merged.get(key);
      if (existing) {
        existing.qty += ing.qty;
      } else {
        merged.set(key, { name: ing.name, qty: ing.qty, unit: ing.unit || null, sourceRecipeId: recipe.id });
      }
    }
  }

  // Replace previously-generated items; keep hand-added (sourceRecipeId IS NULL).
  await db.delete(shoppingListItems).where(isNotNull(shoppingListItems.sourceRecipeId));
  const values = [...merged.values()];
  if (values.length > 0) {
    await db.insert(shoppingListItems).values(values.map((v) => ({
      name: v.name, qty: String(v.qty), unit: v.unit, sourceRecipeId: v.sourceRecipeId,
    })));
  }
  return listShoppingItems();
}

export async function addShoppingItem(input: AddShoppingItemInput): Promise<ShoppingListItem> {
  const [row] = await db.insert(shoppingListItems).values({
    name: input.name,
    qty: input.qty != null ? String(input.qty) : null,
    unit: input.unit ?? null,
    sourceRecipeId: null,
  }).returning();
  return row!;
}

export async function updateShoppingItem(id: string, input: UpdateShoppingItemInput): Promise<ShoppingListItem | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch['name'] = input.name;
  if (input.qty !== undefined) patch['qty'] = input.qty != null ? String(input.qty) : null;
  if (input.unit !== undefined) patch['unit'] = input.unit;
  if (input.checked !== undefined) patch['checked'] = input.checked;
  const [row] = await db.update(shoppingListItems).set(patch).where(eq(shoppingListItems.id, id)).returning();
  return row ?? null;
}

export async function removeShoppingItem(id: string): Promise<ShoppingListItem | null> {
  const [row] = await db.delete(shoppingListItems).where(eq(shoppingListItems.id, id)).returning();
  return row ?? null;
}
