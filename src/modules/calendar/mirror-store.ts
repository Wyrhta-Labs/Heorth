import { and, eq, gte, lte, inArray, or, notInArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { calendarMirrorEvents, type CalendarMirrorEventRow } from './mirror-schema.js';
import type { EventOccurrence } from './schema.js';
import type { MirroredEvent, PullResult } from './providers/types.js';

/**
 * Persistence for the read-only external calendar mirror. Provider-agnostic:
 * the sync runner (`src/m365/calendar-sync.ts`) hands normalized
 * {@link PullResult}s here and this module writes them, with no knowledge of
 * Graph. Native `events` are never touched from here.
 */

function toRow(source: string, feedKey: string, e: MirroredEvent) {
  return {
    source,
    feedKey,
    externalId: e.externalId,
    memberId: e.memberId,
    title: e.title,
    startAt: new Date(e.start.utc),
    endAt: new Date(e.end.utc),
    allDay: e.allDay,
    location: e.location,
    organizer: e.organizer,
    sourceTimeZone: e.start.timeZone,
    seriesMasterId: e.seriesMasterId,
  };
}

/**
 * Apply one feed's pull to the mirror.
 *  - `fullResync`: `upserts` IS the complete current contents of the feed (a
 *    freshly-windowed snapshot, or a 410 recovery). Rows are RECONCILED, not
 *    replaced: everything present is upserted, then everything absent is
 *    deleted. Reconciling rather than truncating keeps `calendar_mirror_events.id`
 *    stable across a resync. Because a re-windowed snapshot contains only events
 *    inside the window, this also correctly drops events that aged out of the
 *    window's past edge — which is what the previous truncate achieved.
 *  - otherwise: upsert `upserts` (by feed + externalId), delete `deletions`
 *    (cascading over `seriesMasterId`) and `masterPurges` (externalId only).
 * Returns the row count now stored for the feed's changed set (for logging).
 */
export async function applyMirrorPull(
  source: string,
  feedKey: string,
  result: PullResult,
): Promise<{ upserted: number; deleted: number }> {
  return db.transaction(async (tx) => {
    let upserted = 0;
    for (const e of result.upserts) {
      await tx.insert(calendarMirrorEvents).values(toRow(source, feedKey, e)).onConflictDoUpdate({
        target: [calendarMirrorEvents.feedKey, calendarMirrorEvents.externalId],
        set: {
          memberId: e.memberId,
          title: e.title,
          startAt: new Date(e.start.utc),
          endAt: new Date(e.end.utc),
          allDay: e.allDay,
          location: e.location,
          organizer: e.organizer,
          sourceTimeZone: e.start.timeZone,
          seriesMasterId: e.seriesMasterId,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      upserted += 1;
    }

    let deleted = 0;

    if (result.fullResync) {
      // Reconcile against the snapshot. `deletions` / `masterPurges` are NOT
      // consulted here: an event the snapshot omits is already deleted below,
      // and a snapshot cannot be trusted to repeat tombstones from before the
      // gap that caused the resync.
      const seen = result.upserts.map((e) => e.externalId);
      const rows = await tx
        .delete(calendarMirrorEvents)
        .where(seen.length > 0
          ? and(
              eq(calendarMirrorEvents.feedKey, feedKey),
              notInArray(calendarMirrorEvents.externalId, seen),
            )
          : eq(calendarMirrorEvents.feedKey, feedKey))
        .returning({ id: calendarMirrorEvents.id });
      deleted = rows.length;
      return { upserted, deleted };
    }

    // Incremental pull. Two channels with different blast radii:
    //  - `deletions` (genuine @removed tombstones): a deleted series is
    //    tombstoned by its MASTER id only, so the delete matches externalId OR
    //    seriesMasterId (the cascade).
    //  - `masterPurges` (still-ALIVE series masters, never displayable): delete
    //    by externalId ONLY. The cascade must not apply — an incremental delta
    //    re-delivers the master without re-delivering the series' unchanged
    //    occurrences, and those mirrored rows must survive.
    if (result.deletions.length > 0) {
      const rows = await tx
        .delete(calendarMirrorEvents)
        .where(and(
          eq(calendarMirrorEvents.feedKey, feedKey),
          or(
            inArray(calendarMirrorEvents.externalId, result.deletions),
            inArray(calendarMirrorEvents.seriesMasterId, result.deletions),
          ),
        ))
        .returning({ id: calendarMirrorEvents.id });
      deleted = rows.length;
    }
    if (result.masterPurges.length > 0) {
      const rows = await tx
        .delete(calendarMirrorEvents)
        .where(and(
          eq(calendarMirrorEvents.feedKey, feedKey),
          inArray(calendarMirrorEvents.externalId, result.masterPurges),
        ))
        .returning({ id: calendarMirrorEvents.id });
      deleted += rows.length;
    }

    return { upserted, deleted };
  });
}

/** Remove every mirrored row for a feed (e.g. when a connection is deleted). */
export async function clearMirrorFeed(feedKey: string): Promise<void> {
  await db.delete(calendarMirrorEvents).where(eq(calendarMirrorEvents.feedKey, feedKey));
}

/**
 * Shape a mirror row as a calendar occurrence so it merges seamlessly into the
 * existing range-query results (dashboard / week / MCP list). Mirrored events
 * are already single occurrences (no recurrence). `source: 'm365'` and no owner
 * marks them read-only for the UI and mutation guards. `attendeeIds` carries the
 * attributed member so the existing `member_id` filter works uniformly.
 */
export function mirrorRowToOccurrence(
  row: CalendarMirrorEventRow,
): EventOccurrence & { attendeeIds: string[]; source: string; feedKey: string; organizer: string | null } {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    allDay: row.allDay,
    location: row.location,
    notes: null,
    category: null,
    color: null,
    createdBy: row.memberId ?? '',
    recurrence: null,
    occurrenceStart: row.startAt.toISOString(),
    attendeeIds: row.memberId ? [row.memberId] : [],
    source: row.source,
    feedKey: row.feedKey,
    organizer: row.organizer,
  };
}

/**
 * Mirrored events overlapping [from, to]. When `memberId` is given, returns that
 * member's attributed events only (shared/family events, having no member, are
 * excluded under a member filter — they belong to no single member).
 */
export async function listMirrorInRange(
  from: Date,
  to: Date,
  memberId?: string,
): Promise<CalendarMirrorEventRow[]> {
  const conds = [
    lte(calendarMirrorEvents.startAt, to),
    gte(calendarMirrorEvents.endAt, from),
  ];
  if (memberId) conds.push(eq(calendarMirrorEvents.memberId, memberId));
  return db.select().from(calendarMirrorEvents).where(and(...conds));
}

/** Whether an id belongs to a mirrored (read-only) event. */
export async function isMirrorEvent(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: calendarMirrorEvents.id })
    .from(calendarMirrorEvents)
    .where(eq(calendarMirrorEvents.id, id))
    .limit(1);
  return !!row;
}

/** Fetch a single mirrored event as an occurrence (read-only detail view). */
export async function getMirrorEvent(id: string) {
  const [row] = await db
    .select()
    .from(calendarMirrorEvents)
    .where(eq(calendarMirrorEvents.id, id))
    .limit(1);
  return row ? mirrorRowToOccurrence(row) : null;
}
