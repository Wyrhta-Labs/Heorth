import { db } from '../../db/index.js';
import { events, eventAttendees, type Event, type EventOccurrence } from './schema.js';
import { expandEvent } from './recurrence.js';
import { eq, and, or, lte, gte, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import type { CreateEventInput, UpdateEventInput, ListEventsQuery } from './validators.js';

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
    const occurrences: Array<EventOccurrence & { attendeeIds: string[] }> = [];
    for (const e of filtered) {
      for (const occ of expandEvent(e, from, to)) {
        occurrences.push({ ...occ, attendeeIds: attendees.get(e.id) ?? [] });
      }
    }
    occurrences.sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
    return { rows: occurrences, total: occurrences.length, limit: occurrences.length, offset: 0 };
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
  if (!row) return null;
  const attendees = await attendeeMap([id]);
  return { ...row, attendeeIds: attendees.get(id) ?? [] };
}

export async function createEvent(input: CreateEventInput, createdBy: string) {
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
  const [row] = await db.delete(events).where(eq(events.id, id)).returning();
  return row ?? null;
}

export async function listUpcoming(memberId: string | null, limit: number) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90); // 90-day window
  const { rows } = await listEvents({
    from: now.toISOString(), to: horizon.toISOString(),
    member_id: memberId ?? undefined,
  });
  return (rows as Array<EventOccurrence & { attendeeIds: string[] }>).slice(0, limit);
}

/** Expose for route-level child-scope checks. */
export async function getEventOwner(id: string): Promise<string | null> {
  const [row] = await db.select({ createdBy: events.createdBy }).from(events).where(eq(events.id, id)).limit(1);
  return row?.createdBy ?? null;
}
