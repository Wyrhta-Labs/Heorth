import { addDaysIso } from '@/lib/format';

/** How many days the "This week" strip shows, today included. */
export const DAY_STRIP_SPAN = 7;

/**
 * The day the start page is focused on: the requested one if it lies in the
 * strip's window (today and the six days after it), otherwise today — so a
 * stale `?day=` from yesterday's bookmark quietly lands on today.
 */
export function focusDay(requested: string | undefined, todayIso: string): string {
  if (!requested) return todayIso;
  const last = addDaysIso(todayIso, DAY_STRIP_SPAN - 1);
  return requested >= todayIso && requested <= last ? requested : todayIso;
}

/**
 * The first `limit` of `items` (already in display order), except that the
 * highlighted ones are kept in view first: a capped list must not hide the very
 * rows the focused day is highlighting. Display order is preserved.
 */
export function keepHighlighted<T>(items: T[], limit: number, isHighlighted: (item: T) => boolean): T[] {
  const highlighted = items.filter(isHighlighted).slice(0, limit);
  const rest = items.filter((i) => !isHighlighted(i)).slice(0, limit - highlighted.length);
  const keep = new Set<T>([...highlighted, ...rest]);
  return items.filter((i) => keep.has(i));
}
