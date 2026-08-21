import { describe, it, expect } from 'vitest';
import { addDuration, isPositiveDuration } from '../src/lib/duration.js';
import { createEventSchema } from '../src/modules/calendar/validators.js';
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

/**
 * `recurrence` is an ISO 8601 duration, never an RRULE. Three separate defects
 * made a single bad value far more expensive than a rejected field:
 *
 *  1. `createEventSchema` accepted ANY string, so the write succeeded.
 *  2. `expandEvent` threw on the unparseable value, and because the range view
 *     expands every event in the window, ONE bad row made
 *     `GET /events?from&to` return 500 for the whole household, permanently.
 *  3. A parseable but non-advancing duration (`P`, `PT0S`) never moved the
 *     cursor, so the loop ran to its 2000 guard emitting duplicates.
 */
describe('recurrence validation', () => {
  it('accepts the durations the expander supports', () => {
    for (const d of ['P1W', 'P1D', 'P1M', 'P1Y', 'PT1H', 'P2W', 'P1Y2M3D', 'PT30M']) {
      expect(isPositiveDuration(d), d).toBe(true);
    }
  });

  it('rejects an RRULE, which is the shape people reach for by habit', () => {
    expect(isPositiveDuration('FREQ=WEEKLY;BYDAY=TU')).toBe(false);
    expect(isPositiveDuration('RRULE:FREQ=DAILY')).toBe(false);
    expect(isPositiveDuration('weekly')).toBe(false);
    expect(isPositiveDuration('')).toBe(false);
  });

  it('rejects a parseable duration that would not advance the cursor', () => {
    // These MATCH the duration regex (every component is optional) but add
    // nothing, which is what used to spin the expansion loop.
    for (const d of ['P', 'PT', 'P0D', 'PT0S', 'P0Y0M0D']) {
      expect(isPositiveDuration(d), d).toBe(false);
    }
  });

  it('rejects a recurrence an event route would accept, at the schema', () => {
    const bad = createEventSchema.safeParse({
      title: 'Bin day',
      startAt: '2026-07-01T07:00:00.000Z',
      endAt: '2026-07-01T07:30:00.000Z',
      recurrence: 'FREQ=WEEKLY;BYDAY=TU',
    });
    expect(bad.success).toBe(false);

    const good = createEventSchema.safeParse({
      title: 'Bin day',
      startAt: '2026-07-01T07:00:00.000Z',
      endAt: '2026-07-01T07:30:00.000Z',
      recurrence: 'P1W',
    });
    expect(good.success).toBe(true);
  });

  it('does not let one bad stored row take down the range view', () => {
    // Rows written before the validator existed are still in the database, so
    // the expander must degrade rather than throw: an unparseable recurrence
    // yields the single base occurrence, exactly like a non-recurring event.
    const occ = expandEvent(
      ev({ recurrence: 'FREQ=WEEKLY;BYDAY=TU' }),
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-31T23:59:59Z'),
    );
    expect(occ.length).toBe(1);
    expect(occ[0]!.occurrenceStart).toBe('2026-07-01T18:00:00.000Z');
  });

  it('does not spin on a stored non-advancing duration', () => {
    const occ = expandEvent(
      ev({ recurrence: 'P0D' }),
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-31T23:59:59Z'),
    );
    expect(occ.length).toBe(1);
  });
});
