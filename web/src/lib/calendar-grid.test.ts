import { describe, it, expect } from 'vitest';
import { monthGrid, groupByDay } from './calendar-grid';
import type { EventOccurrence } from './types';

describe('monthGrid', () => {
  it('produces a 6x7 grid starting on a Monday', () => {
    const grid = monthGrid(2026, 6); // July 2026
    expect(grid.length).toBe(6);
    expect(grid[0]!.length).toBe(7);
    // July 1 2026 is a Wednesday; grid should start Mon Jun 29.
    expect(grid[0]![0]).toBe('2026-06-29');
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
});
