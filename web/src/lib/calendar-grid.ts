import { startOfMonth, startOfWeek, addDays, format } from 'date-fns';
import type { EventOccurrence } from './types';

/** A 6x7 grid of ISO dates covering the month (Monday-first), with leading/trailing days. */
export function monthGrid(year: number, month0: number): string[][] {
  const first = startOfMonth(new Date(year, month0, 1));
  const gridStart = startOfWeek(first, { weekStartsOn: 1 });
  const weeks: string[][] = [];
  let cursor = gridStart;
  for (let w = 0; w < 6; w += 1) {
    const row: string[] = [];
    for (let d = 0; d < 7; d += 1) {
      row.push(format(cursor, 'yyyy-MM-dd'));
      cursor = addDays(cursor, 1);
    }
    weeks.push(row);
  }
  return weeks;
}

/** Group occurrences by their YYYY-MM-DD (from occurrenceStart). */
export function groupByDay(occurrences: EventOccurrence[]): Record<string, EventOccurrence[]> {
  const map: Record<string, EventOccurrence[]> = {};
  for (const o of occurrences) {
    const day = o.occurrenceStart.slice(0, 10);
    (map[day] ??= []).push(o);
  }
  for (const day of Object.keys(map)) {
    map[day]!.sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
  }
  return map;
}
