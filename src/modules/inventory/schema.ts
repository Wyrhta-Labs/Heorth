import { pgTable, text, uuid, timestamp, numeric, date, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** One row = one physical object (spec 2026-08-16). Lifecycle fields live
 *  here so pre-feoh items are backfillable; finance links live feoh-side. */
export const inventoryItems = pgTable('inventory_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  name: text('name').notNull(),
  category: text('category'),
  manufacturer: text('manufacturer'),
  model: text('model'),
  serialNumber: text('serial_number'),
  location: text('location'),
  notes: text('notes'),
  warrantyUntil: date('warranty_until'),
  purchasePrice: numeric('purchase_price', { precision: 14, scale: 2 }),
  purchaseDate: date('purchase_date'),
  decommissionedAt: date('decommissioned_at'),
  decommissionReason: text('decommission_reason'),
  disposalProceeds: numeric('disposal_proceeds', { precision: 14, scale: 2 }),
}, (t) => [
  check('inventory_reason_check', sql`${t.decommissionReason} IS NULL OR ${t.decommissionReason} IN ('broken', 'sold', 'given_away', 'worn_out', 'lost', 'other')`),
  check('inventory_decommission_pair_check', sql`(${t.decommissionedAt} IS NULL) = (${t.decommissionReason} IS NULL)`),
]);

export type InventoryItem = typeof inventoryItems.$inferSelect;
