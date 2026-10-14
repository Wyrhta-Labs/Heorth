import { startOfMonth, startOfWeek, addDays, format } from 'date-fns';
import { todayInTimeZone } from './format';
import type { EventOccurrence } from './types';

/** A 6x7 grid of ISO dates covering the month (Monday first, like every range fetch), with leading/trailing days. */
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

/**
 * The household day (`YYYY-MM-DD`) an ISO instant falls on, read in the
 * household's IANA zone — never the browser's, and never the UTC date a naive
 * `dateStr.slice(0, 10)` would give. `monthGrid` and the week-view day keys
 * are household dates, so every comparison against them goes through this.
 */
function isoOf(dateStr: string, timeZone: string): string {
  return todayInTimeZone(timeZone, new Date(dateStr));
}

/** Group occurrences by their household YYYY-MM-DD (from occurrenceStart). */
export function groupByDay(occurrences: EventOccurrence[], timeZone: string): Record<string, EventOccurrence[]> {
  const map: Record<string, EventOccurrence[]> = {};
  for (const o of occurrences) {
    const day = isoOf(o.occurrenceStart, timeZone);
    (map[day] ??= []).push(o);
  }
  for (const day of Object.keys(map)) {
    map[day]!.sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
  }
  return map;
}
