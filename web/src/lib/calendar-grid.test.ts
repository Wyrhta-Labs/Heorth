// Force a fixed non-UTC offset for this file BEFORE any other import touches
// Date/Intl, so the local-day-boundary assertions below are meaningful in a
// UTC CI runner and not just an accidental pass. Europe/Berlin matches the
// household's assumed locale (UTC+1/+2 with DST) called out in the finding.
process.env.TZ = 'Europe/Berlin';

import { describe, it, expect } from 'vitest';
import { monthGrid, groupByDay } from './calendar-grid';
import type { EventOccurrence } from './types';

describe('monthGrid', () => {
  it('produces a 6x7 grid starting on the locale week start (default enUS: Sunday)', () => {
    const grid = monthGrid(2026, 6); // July 2026
    expect(grid.length).toBe(6);
    expect(grid[0]!.length).toBe(7);
    // July 1 2026 is a Wednesday; enUS (Sunday-first) grid starts Sun Jun 28.
    expect(grid[0]![0]).toBe('2026-06-28');
    expect(grid.flat()).toContain('2026-07-15');
  });
});

describe('groupByDay', () => {
  it('buckets occurrences by day and sorts within a day', () => {
    const occ = (id: string, start: string): EventOccurrence => ({
      id, createdAt: '', updatedAt: '', title: id, startAt: start, endAt: start,
      allDay: false, location: null, notes: null, category: null, color: null,
      createdBy: 'u', recurrence: null, attendeeIds: [], occurrenceStart: start,
    });
    const map = groupByDay([
      occ('b', '2026-07-10T18:00:00.000Z'),
      occ('a', '2026-07-10T09:00:00.000Z'),
      occ('c', '2026-07-11T09:00:00.000Z'),
    ]);
    expect(map['2026-07-10']!.map((o) => o.id)).toEqual(['a', 'b']);
    expect(map['2026-07-11']!.length).toBe(1);
  });

  it('buckets a late-evening UTC instant into the LOCAL next day (Europe/Berlin, UTC+2 in July)', () => {
    const occ = (id: string, start: string): EventOccurrence => ({
      id, createdAt: '', updatedAt: '', title: id, startAt: start, endAt: start,
      allDay: false, location: null, notes: null, category: null, color: null,
      createdBy: 'u', recurrence: null, attendeeIds: [], occurrenceStart: start,
    });
    // 22:30 UTC on 2026-07-10 is 00:30 local on 2026-07-11 in Europe/Berlin (UTC+2).
    const map = groupByDay([occ('a', '2026-07-10T22:30:00.000Z')]);
    expect(map['2026-07-10']).toBeUndefined();
    expect(map['2026-07-11']!.map((o) => o.id)).toEqual(['a']);
  });

  it('keeps an event safely inside a local day on that same day', () => {
    const occ = (id: string, start: string): EventOccurrence => ({
      id, createdAt: '', updatedAt: '', title: id, startAt: start, endAt: start,
      allDay: false, location: null, notes: null, category: null, color: null,
      createdBy: 'u', recurrence: null, attendeeIds: [], occurrenceStart: start,
    });
    // 09:00 UTC on 2026-07-10 is 11:00 local — well inside the same local day.
    const map = groupByDay([occ('a', '2026-07-10T09:00:00.000Z')]);
    expect(map['2026-07-10']!.map((o) => o.id)).toEqual(['a']);
    expect(map['2026-07-11']).toBeUndefined();
  });
});
