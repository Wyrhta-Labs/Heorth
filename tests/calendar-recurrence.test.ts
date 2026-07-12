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
