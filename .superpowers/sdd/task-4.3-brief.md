### Task 4.3: Shopping-list generation (merge like items) + edit/check-off

**Files:**
- Modify: `src/modules/meals/service.ts`, `src/modules/meals/routes.ts`
- Test: `tests/meals-shopping.test.ts`

**Interfaces:**
- Produces (service): `listShoppingItems()`, `generateShoppingList(from, to)` (replaces prior generated items, merges like items by name+unit, preserves hand-added), `addShoppingItem(input)`, `updateShoppingItem(id, input)`, `removeShoppingItem(id)`. Generated items always carry a non-null `sourceRecipeId`; hand-added items have `sourceRecipeId = null`.

- [ ] **Step 1: Append shopping-list functions to `src/modules/meals/service.ts`**

```ts
// Add these imports to the existing import block:
//   shoppingListItems, type ShoppingListItem
//   isNotNull, inArray
import { shoppingListItems, type ShoppingListItem } from './schema.js';
import { isNotNull, inArray } from 'drizzle-orm';
import type { AddShoppingItemInput, UpdateShoppingItemInput } from './validators.js';

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
```

- [ ] **Step 2: Append shopping-list routes to `mealsRouter` in `src/modules/meals/routes.ts`**

```ts
// Add to the imports from validators:
//   addShoppingItemSchema, updateShoppingItemSchema, generateQuerySchema

mealsRouter.get('/shopping-list', async (c) => {
  const items = await service.listShoppingItems();
  return ok(c, items);
});

mealsRouter.post('/shopping-list/generate', async (c) => {
  const q = generateQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'from and to (YYYY-MM-DD) are required', 400);
  const items = await service.generateShoppingList(q.data.from, q.data.to);
  return ok(c, items, undefined, 201);
});

mealsRouter.post('/shopping-list', async (c) => {
  const body = addShoppingItemSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const item = await service.addShoppingItem(body.data);
  return ok(c, item, undefined, 201);
});

mealsRouter.patch('/shopping-list/:id', async (c) => {
  const body = updateShoppingItemSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const item = await service.updateShoppingItem(c.req.param('id'), body.data);
  if (!item) return err(c, 'NOT_FOUND', 'Item not found', 404);
  return ok(c, item);
});

mealsRouter.delete('/shopping-list/:id', async (c) => {
  const item = await service.removeShoppingItem(c.req.param('id'));
  if (!item) return err(c, 'NOT_FOUND', 'Item not found', 404);
  return ok(c, { id: item.id });
});
```

- [ ] **Step 3: Write the failing test**

```ts
// tests/meals-shopping.test.ts
import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/meals/service.js';

describe('shopping list', () => {
  it('merges like ingredients across planned recipes and preserves hand-added items', async () => {
    const { admin } = await seedTestHousehold();
    const a = await service.createRecipe({
      title: 'Soup', servings: 4, ingredients: [{ name: 'Onion', qty: 2, unit: 'each' }, { name: 'Stock', qty: 1, unit: 'L' }], steps: [], tags: [],
    }, admin.user.id);
    const b = await service.createRecipe({
      title: 'Curry', servings: 4, ingredients: [{ name: 'Onion', qty: 3, unit: 'each' }], steps: [], tags: [],
    }, admin.user.id);

    await service.upsertPlanEntry({ date: '2026-07-13', slot: 'supper', recipeId: a.id });
    await service.upsertPlanEntry({ date: '2026-07-14', slot: 'supper', recipeId: b.id });

    // Hand-added item survives generation.
    await service.addShoppingItem({ name: 'Kitchen roll', qty: 1, unit: 'pack' });

    const items = await service.generateShoppingList('2026-07-13', '2026-07-19');
    const onion = items.find((i) => i.name === 'Onion');
    expect(Number(onion!.qty)).toBe(5); // 2 + 3 merged
    expect(onion!.sourceRecipeId).not.toBeNull();
    const handAdded = items.find((i) => i.name === 'Kitchen roll');
    expect(handAdded).toBeTruthy();
    expect(handAdded!.sourceRecipeId).toBeNull();
  });

  it('checks off an item', async () => {
    await seedTestHousehold();
    const item = await service.addShoppingItem({ name: 'Milk', qty: 2, unit: 'L' });
    const updated = await service.updateShoppingItem(item.id, { checked: true });
    expect(updated!.checked).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/meals-shopping.test.ts`
Expected: FAIL first, then PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/meals/service.ts src/modules/meals/routes.ts tests/meals-shopping.test.ts
git commit -m "feat: add shopping-list generation with like-item merge and check-off"
```

---

