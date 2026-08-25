import { pgTable, text, uuid, timestamp, date, integer, boolean, check, index, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';
import { ethelAssets, ethelPlaces } from '../ethel/schema.js';

export const ROUTINE_MODES = ['from_completion', 'fixed'] as const;
export const INTERVAL_UNITS = ['day', 'week', 'month'] as const;
export const OCCURRENCE_STATUSES = ['due', 'completed', 'skipped'] as const;

export type RoutineMode = (typeof ROUTINE_MODES)[number];
export type IntervalUnit = (typeof INTERVAL_UNITS)[number];
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

/** One recurring definition (ADR 0014). The anchor is NULLABLE and unanchored
 *  is the normal case: "put the bins out" and "service the boiler" are the same
 *  kind of row. Two real FKs rather than a polymorphic pair — Wyrtgeard adds a
 *  third column later, and referential integrity is worth more than a column. */
export const weorcRoutines = pgTable('weorc_routines', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  name: text('name').notNull(),
  notes: text('notes'),
  mode: text('mode').notNull(),
  intervalUnit: text('interval_unit').notNull(),
  intervalCount: integer('interval_count').notNull(),
  // `fixed`: the grid origin. `from_completion`: the first due date.
  anchorDate: date('anchor_date').notNull(),
  // How far ahead an occurrence is materialised and projected. A yearly boiler
  // service that reaches To Do on the morning it is due is useless.
  leadDays: integer('lead_days').notNull().default(0),
  // A name, never an assignment mechanic (ADR 0014 §7).
  ownerMemberId: uuid('owner_member_id').references(() => users.id, { onDelete: 'set null' }),
  // SET NULL, like ethel_assets.placeId: deleting the boiler must not delete
  // the record of having serviced it.
  anchorAssetId: uuid('anchor_asset_id').references(() => ethelAssets.id, { onDelete: 'set null' }),
  anchorPlaceId: uuid('anchor_place_id').references(() => ethelPlaces.id, { onDelete: 'set null' }),
  active: boolean('active').notNull().default(true),
}, (t) => [
  check('weorc_routines_mode_check', sql`${t.mode} IN ('from_completion', 'fixed')`),
  check('weorc_routines_unit_check', sql`${t.intervalUnit} IN ('day', 'week', 'month')`),
  check('weorc_routines_count_check', sql`${t.intervalCount} > 0`),
  check('weorc_routines_lead_check', sql`${t.leadDays} >= 0`),
  check('weorc_routines_anchor_check', sql`${t.anchorAssetId} IS NULL OR ${t.anchorPlaceId} IS NULL`),
  index('weorc_routines_active_idx').on(t.active),
  index('weorc_routines_anchor_asset_idx').on(t.anchorAssetId),
  index('weorc_routines_anchor_place_idx').on(t.anchorPlaceId),
]);

/** One due instance. Once terminal it IS the history row — same table, different
 *  status. The task link is (feedKey, externalId), NEVER task_mirror.id: a full
 *  resync deletes and re-inserts a feed's mirror rows, so the uuid is not stable
 *  across a 410 recovery. */
export const weorcOccurrences = pgTable('weorc_occurrences', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  routineId: uuid('routine_id').notNull().references(() => weorcRoutines.id, { onDelete: 'cascade' }),
  dueOn: date('due_on').notNull(),
  status: text('status').notNull().default('due'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedByMemberId: uuid('completed_by_member_id').references(() => users.id, { onDelete: 'set null' }),
  note: text('note'),
  taskFeedKey: text('task_feed_key'),
  taskExternalId: text('task_external_id'),
  projectionError: text('projection_error'),
}, (t) => [
  check('weorc_occurrences_status_check', sql`${t.status} IN ('due', 'completed', 'skipped')`),
  check('weorc_occurrences_completed_pair_check', sql`(${t.status} = 'completed') = (${t.completedAt} IS NOT NULL)`),
  check('weorc_occurrences_task_pair_check', sql`(${t.taskFeedKey} IS NULL) = (${t.taskExternalId} IS NULL)`),
  unique('weorc_occurrences_routine_due_unique').on(t.routineId, t.dueOn),
  // At most one OPEN occurrence per routine, ever — the structural expression
  // of "Weorc is not a task list" (ADR 0014 §6).
  uniqueIndex('weorc_occurrences_one_open_idx').on(t.routineId).where(sql`${t.status} = 'due'`),
  index('weorc_occurrences_status_due_idx').on(t.status, t.dueOn),
]);

export type WeorcRoutine = typeof weorcRoutines.$inferSelect;
export type NewWeorcRoutine = typeof weorcRoutines.$inferInsert;
export type WeorcOccurrence = typeof weorcOccurrences.$inferSelect;
