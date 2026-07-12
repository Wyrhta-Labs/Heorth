### Task 3.1: Calendar schema + recurrence expansion helper

**Files:**
- Create: `src/lib/duration.ts`, `src/modules/calendar/recurrence.ts`, `src/modules/calendar/schema.ts`
- Modify: `src/db/schema/index.ts`, `src/db/schema/drizzle-schema.ts`
- Test: `tests/calendar-recurrence.test.ts`

**Interfaces:**
- Produces:
  - `addDuration(date: Date, iso: string): Date` (shared; ISO 8601 duration like `P1W`, `P1M`).
  - `events`, `eventAttendees` tables; types `Event`, `NewEvent`, `EventOccurrence = Event & { occurrenceStart: string }`.
  - `expandEvent(event: Event, from: Date, to: Date): EventOccurrence[]` — expands a (possibly recurring) event into occurrences overlapping `[from, to]`.

- [ ] **Step 1: Write `src/lib/duration.ts`**

```ts
/** Parse an ISO 8601 duration like P1W / P3M / P1Y / PT1H and add it to a date. */
export function addDuration(date: Date, duration: string): Date {
  const result = new Date(date);
  const weekMatch = duration.match(/^P(\d+)W$/);
  if (weekMatch) {
    result.setDate(result.getDate() + Number(weekMatch[1]) * 7);
    return result;
  }
  const match = duration.match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!match) throw new Error(`Invalid ISO 8601 duration: ${duration}`);
  const [, years, months, days, hours, minutes, seconds] = match.map((v) => (v ? Number(v) : 0));
  if (years) result.setFullYear(result.getFullYear() + years);
  if (months) result.setMonth(result.getMonth() + months);
  if (days) result.setDate(result.getDate() + days);
  if (hours) result.setHours(result.getHours() + hours);
  if (minutes) result.setMinutes(result.getMinutes() + minutes);
  if (seconds) result.setSeconds(result.getSeconds() + seconds);
  return result;
}
```

- [ ] **Step 2: Write `src/modules/calendar/schema.ts`**

```ts
import { pgTable, text, uuid, timestamp, boolean, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

export const events = pgTable('events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  title: text('title').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  allDay: boolean('all_day').notNull().default(false),
  location: text('location'),
  notes: text('notes'),
  category: text('category'),
  color: text('color'),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  recurrence: text('recurrence'),
});

export const eventAttendees = pgTable('event_attendees', {
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.eventId, t.memberId] })]);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventOccurrence = Event & { occurrenceStart: string };
```

- [ ] **Step 3: Write `src/modules/calendar/recurrence.ts`**

```ts
import { addDuration } from '../../lib/duration.js';
import type { Event, EventOccurrence } from './schema.js';

/** Expand a (possibly recurring) event into occurrences overlapping [from, to]. */
export function expandEvent(event: Event, from: Date, to: Date): EventOccurrence[] {
  const durationMs = event.endAt.getTime() - event.startAt.getTime();

  if (!event.recurrence) {
    if (event.startAt <= to && event.endAt >= from) {
      return [{ ...event, occurrenceStart: event.startAt.toISOString() }];
    }
    return [];
  }

  const out: EventOccurrence[] = [];
  let cursorStart = new Date(event.startAt);
  let guard = 0;
  while (cursorStart <= to && guard < 2000) {
    const cursorEnd = new Date(cursorStart.getTime() + durationMs);
    if (cursorEnd >= from) {
      out.push({
        ...event,
        startAt: new Date(cursorStart),
        endAt: cursorEnd,
        occurrenceStart: cursorStart.toISOString(),
      });
    }
    cursorStart = addDuration(cursorStart, event.recurrence);
    guard += 1;
  }
  return out;
}
```

- [ ] **Step 4: Append tables to both schema barrels**

`src/db/schema/index.ts` — add:
```ts
export * from '../../modules/calendar/schema.js';
```
`src/db/schema/drizzle-schema.ts` — add:
```ts
export * from '../../modules/calendar/schema';
```

- [ ] **Step 5: Write the failing test**

```ts
// tests/calendar-recurrence.test.ts
import { describe, it, expect } from 'vitest';
import { addDuration } from '../src/lib/duration.js';
import { expandEvent } from '../src/modules/calendar/recurrence.js';
import type { Event } from '../src/modules/calendar/schema.js';

function ev(overrides: Partial<Event>): Event {
  return {
    id: 'e1', createdAt: new Date(), updatedAt: new Date(),
    title: 'Bins out', startAt: new Date('2026-07-01T18:00:00Z'),
    endAt: new Date('2026-07-01T18:30:00Z'), allDay: false,
    location: null, notes: null, category: null, color: null,
    createdBy: 'u1', recurrence: null, ...overrides,
  };
}

describe('recurrence', () => {
  it('adds a weekly duration', () => {
    expect(addDuration(new Date('2026-07-01T00:00:00Z'), 'P1W').toISOString())
      .toBe('2026-07-08T00:00:00.000Z');
  });

  it('returns a single occurrence for a non-recurring event in range', () => {
    const occ = expandEvent(ev({}), new Date('2026-07-01T00:00:00Z'), new Date('2026-07-31T00:00:00Z'));
    expect(occ.length).toBe(1);
  });

  it('expands a weekly event across the queried month', () => {
    const occ = expandEvent(
      ev({ recurrence: 'P1W' }),
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-31T23:59:59Z'),
    );
    // Jul 1, 8, 15, 22, 29 → 5 occurrences
    expect(occ.length).toBe(5);
    expect(occ[0]!.occurrenceStart).toBe('2026-07-01T18:00:00.000Z');
    expect(occ[4]!.occurrenceStart).toBe('2026-07-29T18:00:00.000Z');
  });

  it('excludes occurrences before the range start', () => {
    const occ = expandEvent(
      ev({ recurrence: 'P1W' }),
      new Date('2026-07-15T00:00:00Z'),
      new Date('2026-07-31T23:59:59Z'),
    );
    expect(occ[0]!.occurrenceStart).toBe('2026-07-15T18:00:00.000Z');
  });
});
```

- [ ] **Step 6: Run test; generate migration**

Run:
```bash
npm test -- tests/calendar-recurrence.test.ts
npm run db:generate   # emits migration adding events + event_attendees
```
Expected: 4 tests PASS; a new migration file appears under `src/db/migrations`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/duration.ts src/modules/calendar/recurrence.ts src/modules/calendar/schema.ts src/db/schema src/db/migrations tests/calendar-recurrence.test.ts
git commit -m "feat: add calendar schema and ISO-8601 recurrence expansion"
```

---

