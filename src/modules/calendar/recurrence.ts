import { addDuration, isPositiveDuration } from '../../lib/duration.js';
import type { Event, EventOccurrence } from './schema.js';

/** Expand a (possibly recurring) event into occurrences overlapping [from, to]. */
export function expandEvent(event: Event, from: Date, to: Date): EventOccurrence[] {
  const durationMs = event.endAt.getTime() - event.startAt.getTime();

  // An unusable recurrence degrades to "not recurring" rather than throwing.
  // `createEventSchema` now rejects these at the boundary, but rows written
  // before it did are still in the database, and this function runs over EVERY
  // event in the requested window — so throwing here would make one bad row a
  // permanent 500 for the whole household's range view, not a lost occurrence.
  // `isPositiveDuration` also screens the non-advancing cases ("P", "P0D"),
  // which would otherwise loop to the iteration guard emitting duplicates.
  if (!event.recurrence || !isPositiveDuration(event.recurrence)) {
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
