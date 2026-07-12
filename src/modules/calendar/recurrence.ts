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
