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
  // ON DELETE SET NULL, deliberately unlike the module's other destructive
  // paths, which refuse: reorganising a house means deleting places that are
  // full, and an unplaced asset is a recoverable state (ADR 0013).
  placeId: uuid('place_id').references(() => ethelPlaces.id, { onDelete: 'set null' }),
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

/** Vehicle detail: an asset PLUS a detail row, not a parallel entity and not
 *  columns on the asset table (ADR 0013 §6). One asset table stays the spine,
 *  so TCO and both feoh links keep working untouched. */
export const ethelVehicles = pgTable('ethel_vehicles', {
  // PK and FK in one: the detail row must not outlive its asset.
  assetId: uuid('asset_id').primaryKey().references(() => ethelAssets.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  registration: text('registration'),
  vin: text('vin'),
  firstRegisteredOn: date('first_registered_on'),
  odometer: integer('odometer'),
  odometerReadAt: date('odometer_read_at'),
  // Stated interval as DOCUMENTATION (ADR 0013 Amendments 1). Weorc never
  // reads it as a trigger - it is a default the routine form offers.
  serviceIntervalMonths: integer('service_interval_months'),
}, (t) => [
  check('ethel_vehicles_odometer_check', sql`${t.odometer} IS NULL OR ${t.odometer} >= 0`),
  // A mileage with no reading date is not a fact - the house style of the
  // decommission pair check.
  check('ethel_vehicles_odometer_pair_check', sql`(${t.odometer} IS NULL) = (${t.odometerReadAt} IS NULL)`),
  check('ethel_vehicles_interval_check', sql`${t.serviceIntervalMonths} IS NULL OR ${t.serviceIntervalMonths} > 0`),
  uniqueIndex('ethel_vehicles_registration_unique').on(t.registration).where(sql`${t.registration} IS NOT NULL`),
  uniqueIndex('ethel_vehicles_vin_unique').on(t.vin).where(sql`${t.vin} IS NOT NULL`),
]);

export type EthelVehicle = typeof ethelVehicles.$inferSelect;

export const facilityKinds = ['heating', 'water', 'electrical', 'solar', 'sewage', 'ventilation', 'network', 'other'] as const;

/** A building system the household maintains but did not buy off a shelf.
 *  Same detail-row shape as ethel_vehicles (spec 2026-08-22, Part C). */
export const ethelFacilities = pgTable('ethel_facilities', {
  assetId: uuid('asset_id').primaryKey().references(() => ethelAssets.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  kind: text('kind').notNull(),
  // When the system went into service - NOT the purchase date, which the
  // asset already holds.
  commissionedOn: date('commissioned_on'),
  serviceIntervalMonths: integer('service_interval_months'),
}, (t) => [
  check('ethel_facilities_kind_check', sql`${t.kind} IN ('heating', 'water', 'electrical', 'solar', 'sewage', 'ventilation', 'network', 'other')`),
  check('ethel_facilities_interval_check', sql`${t.serviceIntervalMonths} IS NULL OR ${t.serviceIntervalMonths} > 0`),
]);

/** Which places a facility SERVES. Distinct from assets.place_id, which is
 *  where the system STANDS: the boiler is in the utility room and heats the
 *  kitchen and the study. Both sides CASCADE because a row here is a link,
 *  not data - deleting a place removes what served it and never the facility. */
export const ethelFacilityPlaces = pgTable('ethel_facility_places', {
  facilityId: uuid('facility_id').notNull().references(() => ethelFacilities.assetId, { onDelete: 'cascade' }),
  placeId: uuid('place_id').notNull().references(() => ethelPlaces.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.facilityId, t.placeId] }),
]);

export type EthelFacility = typeof ethelFacilities.$inferSelect;
export type FacilityKind = (typeof facilityKinds)[number];
