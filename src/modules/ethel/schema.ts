import { pgTable, text, uuid, timestamp, numeric, date, check, integer, uniqueIndex, primaryKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const placeKinds = ['building', 'floor', 'room', 'outdoor', 'storage'] as const;

/** The home itself, as a tree (spec 2026-08-22, Part B). Nesting is
 *  CONVENTIONAL, not enforced: a shed is `outdoor` and holds `storage`. The
 *  kinds exist for display and grouping, not as a grammar. */
export const ethelPlaces = pgTable('ethel_places', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => ethelPlaces.id, { onDelete: 'restrict' }),
  notes: text('notes'),
}, (t) => [
  check('ethel_places_kind_check', sql`${t.kind} IN ('building', 'floor', 'room', 'outdoor', 'storage')`),
  // The one cycle Postgres CAN declare. Deeper cycles are a service check.
  check('ethel_places_self_parent_check', sql`${t.id} <> ${t.parentId}`),
  // NOTE: the sibling-name unique is NOT declared here. It needs BOTH an
  // expression (lower(name)) and NULLS NOT DISTINCT, and drizzle-orm 0.45 can
  // express only one at a time: uniqueIndex() takes expressions but has no
  // .nullsNotDistinct(), and unique() has .nullsNotDistinct() but takes plain
  // columns. It is created as a raw statement appended to the migration -
  // see ethel_places_parent_name_unique in src/db/migrations/.
]);

export type EthelPlace = typeof ethelPlaces.$inferSelect;
export type PlaceKind = (typeof placeKinds)[number];

/** One row = one physical object the household owns (spec 2026-08-22, Part A).
 *  Lifecycle fields live here; finance links live feoh-side. */
export const ethelAssets = pgTable('ethel_assets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  name: text('name').notNull(),
  category: text('category'),
  manufacturer: text('manufacturer'),
  model: text('model'),
  serialNumber: text('serial_number'),
  locationNote: text('location_note'),
  notes: text('notes'),
  warrantyUntil: date('warranty_until'),
  purchasePrice: numeric('purchase_price', { precision: 14, scale: 2 }),
  purchaseDate: date('purchase_date'),
  decommissionedAt: date('decommissioned_at'),
  decommissionReason: text('decommission_reason'),
  disposalProceeds: numeric('disposal_proceeds', { precision: 14, scale: 2 }),
}, (t) => [
  check('ethel_assets_reason_check', sql`${t.decommissionReason} IS NULL OR ${t.decommissionReason} IN ('broken', 'sold', 'given_away', 'worn_out', 'lost', 'other')`),
  check('ethel_assets_decommission_pair_check', sql`(${t.decommissionedAt} IS NULL) = (${t.decommissionReason} IS NULL)`),
]);

export type EthelAsset = typeof ethelAssets.$inferSelect;
