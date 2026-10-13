import { pgTable, text, boolean, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Heorth's own household-wide display settings. The `household` row itself
 * belongs to @wyrhta/core and is shared with KithLedger, so a Heorth-only UI
 * concern like the theme lives here instead of widening that table. One row,
 * enforced the same way core does it: the key is a boolean fixed to `true`.
 * A missing row means every default applies (`getHousehold` fills them in).
 */
export const householdAppearance = pgTable('household_appearance', {
  singleton: boolean('singleton').primaryKey().default(true),
  theme: text('theme').notNull().default('slate'),
}, (t) => [
  check('household_appearance_singleton', sql`${t.singleton}`),
]);
