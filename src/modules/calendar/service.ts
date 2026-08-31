import { db } from '../../db/index.js';
import { events, eventAttendees, type Event, type EventOccurrence } from './schema.js';
import { expandEvent } from './recurrence.js';
import { eq, and, or, lte, gte, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import type { CreateEventInput, UpdateEventInput, ListEventsQuery } from './validators.js';
import { listMirrorInRange, mirrorRowToOccurrence, isMirrorEvent, getMirrorEvent } from './mirror-store.js';
import { assertNotMaintenanceAdmin, assertNoneAreMaintenanceAdmin } from '../../household/maintenance-admin.js';
import { listProviders } from '../../integrations/registry.js';
import {
  getCalendarAllowlist, setCalendarAllowlist, getHouseholdCalendar, setHouseholdCalendar,
  type CalendarAllowlistFeed,
} from './allowlist-store.js';
import type { CalendarAllowlistRow } from './allowlist-schema.js';
import type { AvailableCalendar } from './providers/types.js';

/** An occurrence carrying its source; native events are `'native'`. */
export type OccurrenceView = EventOccurrence & {
  attendeeIds: string[];
  source: string;
  feedKey?: string;
  organizer?: string | null;
};

/** Thrown when a caller tries to mutate a read-only mirrored (external) event. */
export class ReadOnlyEventError extends Error {
  constructor() {
    super('Mirrored M365 events are read-only');
    this.name = 'ReadOnlyEventError';
  }
}

async function attendeeMap(eventIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (eventIds.length === 0) return map;
  const rows = await db.select().from(eventAttendees).where(inArray(eventAttendees.eventId, eventIds));
  for (const r of rows) {
    const list = map.get(r.eventId) ?? [];
    list.push(r.memberId);
    map.set(r.eventId, list);
  }
  return map;
}

async function setAttendees(eventId: string, memberIds: string[]): Promise<void> {
  await db.delete(eventAttendees).where(eq(eventAttendees.eventId, eventId));
  if (memberIds.length > 0) {
    await db.insert(eventAttendees).values(memberIds.map((memberId) => ({ eventId, memberId })));
  }
}

export async function listEvents(query: ListEventsQuery) {
  // Range view: expand recurrence within [from, to].
  if (query.from && query.to) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const candidates = await db.select().from(events).where(
      or(
        and(isNull(events.recurrence), gte(events.endAt, from), lte(events.startAt, to)),
        and(isNotNull(events.recurrence), lte(events.startAt, to)),
      ),
    );

    let filtered = candidates;
    if (query.member_id) {
      const attending = await db
        .select({ eventId: eventAttendees.eventId })
        .from(eventAttendees)
        .where(eq(eventAttendees.memberId, query.member_id));
      const attendingIds = new Set(attending.map((a) => a.eventId));
      filtered = candidates.filter((e) => e.createdBy === query.member_id || attendingIds.has(e.id));
    }

    const attendees = await attendeeMap(filtered.map((e) => e.id));
    const occurrences: OccurrenceView[] = [];
    for (const e of filtered) {
      for (const occ of expandEvent(e, from, to)) {
        occurrences.push({ ...occ, attendeeIds: attendees.get(e.id) ?? [], source: 'native' });
      }
    }

    // Merge read-only mirrored external events (M365, etc.) into the same range
    // result so dashboard / week / MCP list surfaces show them alongside native
    // events. Mirrored occurrences are already expanded (no recurrence).
    const mirrored = await listMirrorInRange(from, to, query.member_id);
    for (const row of mirrored) occurrences.push(mirrorRowToOccurrence(row));

    occurrences.sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));

    // `limit`/`offset` bound the EXPANDED OCCURRENCES, not the underlying event
    // rows: a single weekly event can produce dozens of occurrences in a range,
    // so the window has to be applied after expansion + mirror merge + sort.
    // Both are optional and omitting them keeps the pre-existing behaviour
    // (every occurrence in the range, in chronological order).
    const total = occurrences.length;
    const rangeOffset = Math.max(0, query.offset ?? 0);
    const rangeLimit = query.limit === undefined ? undefined : Math.min(100, Math.max(1, query.limit));
    const page = rangeOffset === 0 && rangeLimit === undefined
      ? occurrences
      : occurrences.slice(rangeOffset, rangeLimit === undefined ? undefined : rangeOffset + rangeLimit);
    return { rows: page, total, limit: rangeLimit ?? page.length, offset: rangeOffset };
  }

  // No range: raw, paginated list.
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = Math.max(0, query.offset ?? 0);
  const rows = await db.select().from(events).orderBy(events.startAt).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(events);
  const attendees = await attendeeMap(rows.map((e) => e.id));
  return {
    rows: rows.map((e) => ({ ...e, attendeeIds: attendees.get(e.id) ?? [] })),
    total: count, limit, offset,
  };
}

export async function getEvent(id: string) {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!row) {
    // Fall back to the read-only mirror so external events have a detail view.
    return getMirrorEvent(id);
  }
  const attendees = await attendeeMap([id]);
  return { ...row, attendeeIds: attendees.get(id) ?? [], source: 'native' as const };
}

/** Classify an id: a native event, a read-only mirrored event, or unknown. */
export async function getEventSource(id: string): Promise<'native' | 'mirror' | null> {
  const [row] = await db.select({ id: events.id }).from(events).where(eq(events.id, id)).limit(1);
  if (row) return 'native';
  return (await isMirrorEvent(id)) ? 'mirror' : null;
}

export async function createEvent(input: CreateEventInput, createdBy: string) {
  // The maintenance admin is not a household person: it may neither own nor
  // attend anything. Guarded here (service layer) so REST, MCP and API-key
  // callers are all covered by one implementation.
  await assertNotMaintenanceAdmin(createdBy);
  await assertNoneAreMaintenanceAdmin(input.attendeeIds ?? []);

  const [row] = await db.insert(events).values({
    title: input.title,
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    allDay: input.allDay,
    location: input.location ?? null,
    notes: input.notes ?? null,
    category: input.category ?? null,
    color: input.color ?? null,
    recurrence: input.recurrence ?? null,
    createdBy,
  }).returning();
  await setAttendees(row!.id, input.attendeeIds ?? []);
  return getEvent(row!.id);
}

export async function updateEvent(id: string, input: UpdateEventInput) {
  if (await isMirrorEvent(id)) throw new ReadOnlyEventError();
  if (input.attendeeIds) await assertNoneAreMaintenanceAdmin(input.attendeeIds);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch['title'] = input.title;
  if (input.startAt !== undefined) patch['startAt'] = new Date(input.startAt);
  if (input.endAt !== undefined) patch['endAt'] = new Date(input.endAt);
  if (input.allDay !== undefined) patch['allDay'] = input.allDay;
  if (input.location !== undefined) patch['location'] = input.location;
  if (input.notes !== undefined) patch['notes'] = input.notes;
  if (input.category !== undefined) patch['category'] = input.category;
  if (input.color !== undefined) patch['color'] = input.color;
  if (input.recurrence !== undefined) patch['recurrence'] = input.recurrence;

  const [row] = await db.update(events).set(patch).where(eq(events.id, id)).returning();
  if (!row) return null;
  if (input.attendeeIds !== undefined) await setAttendees(id, input.attendeeIds);
  return getEvent(id);
}

export async function moveEvent(id: string, startAt: string, endAt?: string) {
  if (await isMirrorEvent(id)) throw new ReadOnlyEventError();
  const [existing] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!existing) return null;
  const newStart = new Date(startAt);
  const newEnd = endAt
    ? new Date(endAt)
    : new Date(newStart.getTime() + (existing.endAt.getTime() - existing.startAt.getTime()));
  await db.update(events).set({ startAt: newStart, endAt: newEnd, updatedAt: new Date() }).where(eq(events.id, id));
  return getEvent(id);
}

export async function deleteEvent(id: string) {
  if (await isMirrorEvent(id)) throw new ReadOnlyEventError();
  const [row] = await db.delete(events).where(eq(events.id, id)).returning();
  return row ?? null;
}

export async function listUpcoming(memberId: string | null, limit: number) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90); // 90-day window
  // Expressed entirely as a bounded range query, so the REST endpoint
  // (`GET /api/v1/events?from&to&member_id&limit`) reproduces it exactly.
  const { rows } = await listEvents({
    from: now.toISOString(), to: horizon.toISOString(),
    member_id: memberId ?? undefined,
    limit,
  });
  return rows as Array<EventOccurrence & { attendeeIds: string[] }>;
}

/** Expose for route-level child-scope checks. */
export async function getEventOwner(id: string): Promise<string | null> {
  const [row] = await db.select({ createdBy: events.createdBy }).from(events).where(eq(events.id, id)).limit(1);
  return row?.createdBy ?? null;
}

/**
 * Calendar discovery + allowlist management. The shape deliberately mirrors the
 * tasks module's list picker: every entry is tagged with its provider, so the
 * picker can group them and `setCalendarAllowlistFor` knows which provider a
 * chosen calendar belongs to.
 */
export interface AvailableCalendarView {
  provider: string;
  id: string;
  name: string;
  enabled: boolean;
  isHousehold: boolean;
}

/** Thrown for a calendar the member cannot access or has not allowlisted. */
export class UnknownCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownCalendarError';
  }
}

export async function listAvailableCalendars(memberId: string): Promise<AvailableCalendarView[]> {
  await assertNotMaintenanceAdmin(memberId);
  const out: AvailableCalendarView[] = [];
  for (const p of listProviders()) {
    if (!p.calendar) continue;
    // One provider being unreachable must not hide another's calendars — the
    // same rule the tasks picker learned the hard way in Phase 1.
    let calendars: AvailableCalendar[];
    try {
      calendars = await p.calendar.listAvailableCalendars(memberId);
    } catch (e) {
      if (p.classifyError(e) === 'no_connection') continue;
      throw e;
    }
    const rows = await getCalendarAllowlist(memberId, p.id);
    const byId = new Map(rows.map((r) => [r.calendarId, r]));
    for (const c of calendars) {
      const row = byId.get(c.id);
      out.push({
        provider: p.id, id: c.id, name: c.name,
        enabled: row !== undefined, isHousehold: row?.isHousehold ?? false,
      });
    }
  }
  return out;
}

/**
 * Replace the member's calendar selection. Scoped per provider: a provider
 * whose discovery failed with `no_connection` keeps its rows untouched, so a
 * temporarily unreachable account cannot silently wipe a selection the member
 * never saw in the picker.
 */
export async function setCalendarAllowlistFor(
  memberId: string, entries: Array<{ provider: string; calendarId: string }>,
): Promise<CalendarAllowlistRow[]> {
  await assertNotMaintenanceAdmin(memberId);
  const out: CalendarAllowlistRow[] = [];
  for (const p of listProviders()) {
    if (!p.calendar) continue;
    let available: AvailableCalendar[];
    try {
      available = await p.calendar.listAvailableCalendars(memberId);
    } catch (e) {
      if (p.classifyError(e) === 'no_connection') continue;
      throw e;
    }
    const byId = new Map(available.map((c) => [c.id, c.name]));
    const selected: Array<{ id: string; name: string | null }> = [];
    for (const entry of entries.filter((e) => e.provider === p.id)) {
      if (!byId.has(entry.calendarId)) {
        throw new UnknownCalendarError(`Calendar not accessible for this member: ${entry.calendarId}`);
      }
      selected.push({ id: entry.calendarId, name: byId.get(entry.calendarId) ?? null });
    }
    out.push(...await setCalendarAllowlist(memberId, p.id, selected));
  }
  return out;
}

/**
 * Designate the household calendar. It must already be allowlisted —
 * designating an unsynced calendar would produce a family feed nothing pulls.
 */
export async function designateHouseholdCalendar(
  memberId: string, provider: string, calendarId: string,
): Promise<void> {
  const owned = await getCalendarAllowlist(memberId, provider);
  if (!owned.some((r) => r.calendarId === calendarId)) {
    throw new UnknownCalendarError(
      "That calendar is not in the member's allowlist — allowlist it before designating it",
    );
  }
  await setHouseholdCalendar(memberId, provider, calendarId);
}

export async function getHouseholdCalendarView(): Promise<CalendarAllowlistFeed | null> {
  return getHouseholdCalendar();
}
