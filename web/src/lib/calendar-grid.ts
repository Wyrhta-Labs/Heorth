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

/**
 * Local-day bucket key for an ISO instant. Household timezone === server/
 * browser local (this is a self-hosted, single-household deployment — there is
 * no cross-timezone household to reconcile), so the LOCAL calendar day is the
 * correct reset/bucketing boundary. A naive `dateStr.slice(0, 10)` reads the
 * UTC date instead: in UTC+1/+2 that shifts the midnight reset to 01:00–02:00
 * local and mis-buckets late-evening timed events into the wrong day column.
 * `monthGrid` and the week-view day keys are already local-formatted (see
 * `format` above / `dayLabel` in lib/format.ts), so every comparison against
 * them must go through this same local formatting.
 */
function isoOf(dateStr: string): string {
  return format(new Date(dateStr), 'yyyy-MM-dd');
}

/** Group occurrences by their local YYYY-MM-DD (from occurrenceStart). */
export function groupByDay(occurrences: EventOccurrence[]): Record<string, EventOccurrence[]> {
  const map: Record<string, EventOccurrence[]> = {};
  for (const o of occurrences) {
    const day = isoOf(o.occurrenceStart);
    (map[day] ??= []).push(o);
  }
  for (const day of Object.keys(map)) {
    map[day]!.sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
  }
  return map;
}
