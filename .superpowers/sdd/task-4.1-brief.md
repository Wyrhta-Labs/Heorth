### Task 4.1: Meals schema + migration

**Files:**
- Create: `src/modules/meals/schema.ts`
- Modify: `src/db/schema/index.ts`, `src/db/schema/drizzle-schema.ts`
- Test: `tests/meals-schema.test.ts`

**Interfaces:**
- Produces: `recipes`, `mealPlanEntries`, `shoppingListItems` tables; types `Recipe`, `NewRecipe`, `Ingredient`, `MealPlanEntry`, `ShoppingListItem`; `MEAL_SLOTS`.

- [ ] **Step 1: Write `src/modules/meals/schema.ts`**

```ts
import { pgTable, text, uuid, timestamp, integer, boolean, jsonb, numeric, date, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

export const MEAL_SLOTS = ['breakfast', 'lunch', 'supper'] as const;

export interface Ingredient {
  name: string;
  qty: number;
  unit: string;
}

export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  title: text('title').notNull(),
  servings: integer('servings').notNull().default(1),
  ingredients: jsonb('ingredients').$type<Ingredient[]>().notNull().default(sql`'[]'::jsonb`),
  steps: jsonb('steps').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  tags: text('tags').array().notNull().default(sql`'{}'`),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
});

export const mealPlanEntries = pgTable('meal_plan_entries', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  date: date('date').notNull(),
  slot: text('slot').notNull(),
  recipeId: uuid('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
  freeText: text('free_text'),
  cook: uuid('cook').references(() => users.id, { onDelete: 'set null' }),
  helper: uuid('helper').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [
  unique('meal_plan_date_slot').on(t.date, t.slot),
  check('meal_slot_check', sql`${t.slot} IN ('breakfast', 'lunch', 'supper')`),
]);

export const shoppingListItems = pgTable('shopping_list_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  name: text('name').notNull(),
  qty: numeric('qty', { precision: 10, scale: 2 }),
  unit: text('unit'),
  checked: boolean('checked').notNull().default(false),
  sourceRecipeId: uuid('source_recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
});

export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type MealPlanEntry = typeof mealPlanEntries.$inferSelect;
export type ShoppingListItem = typeof shoppingListItems.$inferSelect;
```

- [ ] **Step 2: Append to both schema barrels**

`src/db/schema/index.ts`: add `export * from '../../modules/meals/schema.js';`
`src/db/schema/drizzle-schema.ts`: add `export * from '../../modules/meals/schema';`

- [ ] **Step 3: Write the failing test**

```ts
// tests/meals-schema.test.ts
import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { db } from '../src/db/index.js';
import { recipes } from '../src/modules/meals/schema.js';

describe('meals schema', () => {
  it('stores ingredients and steps as JSON', async () => {
    const { admin } = await seedTestHousehold();
    const [row] = await db.insert(recipes).values({
      title: 'Pasta', servings: 4,
      ingredients: [{ name: 'Pasta', qty: 500, unit: 'g' }],
      steps: ['Boil water', 'Cook pasta'], tags: ['quick'], createdBy: admin.user.id,
    }).returning();
    expect(row!.ingredients[0]!.name).toBe('Pasta');
    expect(row!.steps.length).toBe(2);
    expect(row!.tags).toEqual(['quick']);
  });
});
```

- [ ] **Step 4: Run test; generate migration**

Run:
```bash
npm run db:generate
npm test -- tests/meals-schema.test.ts
```
Expected: migration created; test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/meals/schema.ts src/db/schema src/db/migrations tests/meals-schema.test.ts
git commit -m "feat: add meals schema (recipes, meal plan entries, shopping list)"
```

---

