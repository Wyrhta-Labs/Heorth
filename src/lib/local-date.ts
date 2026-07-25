/**
 * Pure calendar-date <-> instant helpers for an IANA timezone, built on raw
 * `Date` + `Intl` only (no timezone library — a deliberate backend constraint).
 *
 * Used by the M365 To Do provider: Graph's `dueDateTime`/`completedDateTime`
 * are CALENDAR DATES (truncated to midnight in the author's zone, returned as
 * a UTC instant), so the provider converts between "the date the household
 * means" and "the UTC instant we store" through these two functions.
 *
 * Unknown-zone handling lives with the caller (the household zone resolver
 * falls back to UTC); these throw whatever `Intl` throws for a bad zone.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function partsFormatter(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
}

/** The wall-clock time of `instant` in `zone`, re-encoded as a UTC epoch-ms value. */
function wallClockUtcMs(instant: Date, zone: string): number {
  const parts = partsFormatter(zone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

/** The `YYYY-MM-DD` calendar date of `instant` as seen in `zone`. */
export function localDateOf(instant: Date | string, zone: string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new Error(`localDateOf: invalid instant: ${String(instant)}`);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * The UTC instant of local midnight of `date` (`YYYY-MM-DD`) in `zone`.
 * Offset-inversion via formatToParts with iterative correction, so DST
 * boundary days resolve correctly; if local midnight does not exist
 * (a spring-forward exactly at midnight) the first instant after the gap wins.
 */
export function zonedMidnightUtc(date: string, zone: string): Date {
  if (!DATE_RE.test(date)) throw new Error(`zonedMidnightUtc: malformed date (want YYYY-MM-DD): ${date}`);
  const targetWall = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(targetWall)) throw new Error(`zonedMidnightUtc: invalid date: ${date}`);

  // Start from UTC midnight, then correct by the observed wall-clock error.
  // A second pass handles guesses that landed across a DST transition.
  let guess = targetWall;
  for (let i = 0; i < 3; i++) {
    const diff = targetWall - wallClockUtcMs(new Date(guess), zone);
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}
