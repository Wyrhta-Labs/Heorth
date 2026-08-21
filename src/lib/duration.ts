/**
 * The subset of ISO 8601 durations Heorth understands: P1W / P3M / P1Y / PT1H.
 *
 * This is the vocabulary of `events.recurrence` — **not** an RRULE. `FREQ=…` is
 * the shape most people reach for by habit and is rejected here, because the
 * expander (`src/modules/calendar/recurrence.ts`) advances a cursor by a fixed
 * duration and has no concept of BYDAY, COUNT, or UNTIL.
 */

/** A duration broken into its components. Every field is a non-negative integer. */
export interface DurationParts {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const WEEKS = /^P(\d+)W$/;
// Every component is optional, so this also matches the degenerate "P" and "PT".
// `isPositiveDuration` is what rejects those; see its comment.
const COMPONENTS =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** Parse a supported duration, or return `null` if the string is not one. */
export function parseDuration(duration: string): DurationParts | null {
  const zero: DurationParts = { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };

  const weeks = duration.match(WEEKS);
  if (weeks) return { ...zero, days: Number(weeks[1]) * 7 };

  const match = duration.match(COMPONENTS);
  if (!match) return null;
  const [, years, months, days, hours, minutes, seconds] = match.map((v) => (v ? Number(v) : 0));
  return {
    years: years!, months: months!, days: days!,
    hours: hours!, minutes: minutes!, seconds: seconds!,
  };
}

/**
 * Whether `duration` is a supported duration that actually ADVANCES a date.
 *
 * The advancement half matters as much as the parse. `COMPONENTS` makes every
 * field optional, so "P", "PT", "P0D" and "PT0S" all parse cleanly and add
 * nothing — as a recurrence they would leave the expansion cursor where it was
 * and emit duplicate occurrences until the loop hit its iteration guard. A
 * recurrence that never moves is not a recurrence, so it is not valid input.
 */
export function isPositiveDuration(duration: string): boolean {
  const parts = parseDuration(duration);
  return parts !== null && Object.values(parts).some((n) => n > 0);
}

/**
 * Add a supported duration to a date.
 *
 * Throws on anything `parseDuration` rejects. Callers that must not fail on a
 * value already stored in the database should test it with `isPositiveDuration`
 * first rather than catching — see `expandEvent`.
 */
export function addDuration(date: Date, duration: string): Date {
  const parts = parseDuration(duration);
  if (!parts) throw new Error(`Invalid ISO 8601 duration: ${duration}`);

  const result = new Date(date);
  if (parts.years) result.setFullYear(result.getFullYear() + parts.years);
  if (parts.months) result.setMonth(result.getMonth() + parts.months);
  if (parts.days) result.setDate(result.getDate() + parts.days);
  if (parts.hours) result.setHours(result.getHours() + parts.hours);
  if (parts.minutes) result.setMinutes(result.getMinutes() + parts.minutes);
  if (parts.seconds) result.setSeconds(result.getSeconds() + parts.seconds);
  return result;
}
