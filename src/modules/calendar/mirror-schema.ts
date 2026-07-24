import { pgTable, text, uuid, timestamp, boolean, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

/**
 * Read-only mirror of external (M365, later Google/CalDAV) calendar events.
 *
 * A SIBLING of `events` rather than columns on it — chosen so:
 *  - native `events` stays untouched (its `created_by` FK, mutation paths, and
 *    recurrence expansion carry no null/branching for a foreign source);
 *  - read-only is STRUCTURAL: there are simply no write routes/tools targeting
 *    this table (the REST/MCP mutation guards reject any id that resolves here);
 *  - a whole feed can be replaced atomically on a full re-sync (410) by
 *    `feed_key` without risking native rows.
 *
 * Mirrors the `library_items` precedent (external items in their own table,
 * `externalId` unique per source stream, joined into read queries).
 *
 * Occurrences of recurring events are stored already-expanded (one row each);
 * we never reconstruct recurrence rules, so there is no `recurrence` column.
 */
export const calendarMirrorEvents = pgTable('calendar_mirror_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`now()`),
  // Source discriminator (e.g. 'm365'); future providers reuse this table.
  source: text('source').notNull(),
  // Canonical sync feed key (calendar:member:<id> | calendar:family).
  feedKey: text('feed_key').notNull(),
  // Stable id within the feed (Graph event/occurrence id).
  externalId: text('external_id').notNull(),
  // Household member this event is attributed to; null for the shared family feed.
  memberId: uuid('member_id').references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  // Absolute instants (see providers/types.ts — source zone kept as metadata).
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  allDay: boolean('all_day').notNull().default(false),
  location: text('location'),
  organizer: text('organizer'),
  // The source event's own timezone (IANA/Windows id), display metadata only.
  sourceTimeZone: text('source_time_zone'),
}, (t) => [
  // One row per (feed, external event). A full re-sync replaces by feed_key.
  unique('calendar_mirror_feed_ext_unique').on(t.feedKey, t.externalId),
  index('calendar_mirror_feed_idx').on(t.feedKey),
  index('calendar_mirror_member_idx').on(t.memberId),
  index('calendar_mirror_start_idx').on(t.startAt),
]);

export type CalendarMirrorEventRow = typeof calendarMirrorEvents.$inferSelect;
export type NewCalendarMirrorEvent = typeof calendarMirrorEvents.$inferInsert;
