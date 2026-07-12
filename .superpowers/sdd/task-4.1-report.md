# Task 4.1 Report: Meals schema + migration

## Summary

Transcribed the brief verbatim: `src/modules/meals/schema.ts` defines `recipes`,
`mealPlanEntries` (`meal_plan_entries`), and `shoppingListItems` (`shopping_list_items`),
plus `MEAL_SLOTS`, the `Ingredient` interface, and the `Recipe`/`NewRecipe`/
`MealPlanEntry`/`ShoppingListItem` types. Appended to both schema barrels
(`src/db/schema/index.ts` with `.js` extension, `src/db/schema/drizzle-schema.ts`
without). Added `tests/meals-schema.test.ts`.

## Migration SQL summary (`src/db/migrations/0002_deep_silk_fever.sql`)

- `CREATE TABLE "meal_plan_entries"`: 9 columns (id, created_at, updated_at, date,
  slot, recipe_id, free_text, cook, helper).
  - `CONSTRAINT "meal_plan_date_slot" UNIQUE("date","slot")` — confirmed present.
  - `CONSTRAINT "meal_slot_check" CHECK ("meal_plan_entries"."slot" IN ('breakfast', 'lunch', 'supper'))` — confirmed present.
- `CREATE TABLE "recipes"`: 9 columns (id, created_at, updated_at, title, servings,
  ingredients jsonb, steps jsonb, tags text[], created_by).
- `CREATE TABLE "shopping_list_items"`: 8 columns (id, created_at, updated_at, name,
  qty numeric(10,2), unit, checked, source_recipe_id).
- FK constraints added after table creation:
  - `meal_plan_entries.recipe_id -> recipes.id` (ON DELETE SET NULL)
  - `meal_plan_entries.cook -> users.id` (ON DELETE SET NULL)
  - `meal_plan_entries.helper -> users.id` (ON DELETE SET NULL)
  - `recipes.created_by -> users.id` (ON DELETE CASCADE)
  - `shopping_list_items.source_recipe_id -> recipes.id` (ON DELETE SET NULL)

All 3 tables, the unique(date, slot) constraint, and the slot check constraint are
present exactly as specified in the brief.

## Test result

`npm test -- tests/meals-schema.test.ts` → 1 passed (1 test file, 1 test).
Verifies ingredients/steps stored and round-tripped as JSON, and tags as a text array.

## Typecheck

`npm run typecheck` → clean, no errors.

## Full suite

`npm test` → 12 test files passed, 35 tests passed (34 prior + 1 new).

## Git integrity

- Commit `b88a30e` "feat: add meals schema (recipes, meal plan entries, shopping list)".
- `git show --stat HEAD` lists exactly: `src/db/migrations/0002_deep_silk_fever.sql`,
  `src/db/migrations/meta/0002_snapshot.json`, `src/db/migrations/meta/_journal.json`,
  `src/db/schema/drizzle-schema.ts`, `src/db/schema/index.ts`,
  `src/modules/meals/schema.ts`, `tests/meals-schema.test.ts`.
- The generated `.sql` migration (`0002_deep_silk_fever.sql`) is confirmed committed
  (shows as `create mode 100644` in the commit).
- `git status --short` after commit: clean except for pre-existing untracked
  `.superpowers/` directory (out of scope for this task, not touched).
- No amend was needed; the `.sql` was staged and committed on the first attempt.

## Concerns

None. No Co-Authored-By trailer was added, per instructions. `.env` was not staged
or committed.
