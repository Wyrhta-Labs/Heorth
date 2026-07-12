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
