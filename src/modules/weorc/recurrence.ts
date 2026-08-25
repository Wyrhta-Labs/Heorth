import type { IntervalUnit, RoutineMode } from './schema.js';

/**
 * Pure calendar arithmetic for Weorc routines. No database, no clock, no
 * timezone: every function takes and returns `YYYY-MM-DD` strings, so the
 * awkward cases (month-end clamping, the fixed-grid fast-forward) are testable
 * without a Postgres round-trip or a frozen clock.
 *
 * "Today" is supplied by the caller and comes from the HOUSEHOLD's zone - see
 * dates.ts. Nothing here reads `new Date()`.
 */

export interface RecurrenceSpec {
  mode: RoutineMode;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  anchorDate: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parse(date: string): { y: number; m: number; d: number } {
  if (!DATE_RE.test(date)) throw new Error(`weorc/recurrence: malformed date (want YYYY-MM-DD): ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add whole days. Pure calendar arithmetic via UTC - never a local-time
 *  `Date`, whose DST transitions would make a "+1 day" step 23 or 25 hours. */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Add whole months, CLAMPING into the target month: 31 Jan + 1 month is
 *  28 Feb (29 in a leap year). Callers that must not drift compute every step
 *  from a fixed origin rather than from the previous result. */
export function addMonths(date: string, months: number): string {
  const { y, m, d } = parse(date);
  const total = (y * 12) + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addInterval(date: string, unit: IntervalUnit, count: number): string {
  switch (unit) {
    case 'day': return addDays(date, count);
    case 'week': return addDays(date, count * 7);
    case 'month': return addMonths(date, count);
  }
}

/** The k-th grid slot, ALWAYS computed from the origin so month-end clamping
 *  cannot accumulate: 31 Jan yields 28 Feb then 31 Mar, not 28 Mar. */
function slotAt(spec: RecurrenceSpec, k: number): string {
  return addInterval(spec.anchorDate, spec.intervalUnit, spec.intervalCount * k);
}

/** A cheap starting guess for k, corrected by the loop in `nextDueOn`. Only an
 *  estimate - correctness comes from the correction, not from this. */
function estimateK(spec: RecurrenceSpec, target: string): number {
  const a = parse(spec.anchorDate);
  const t = parse(target);
  if (spec.intervalUnit === 'month') {
    const months = ((t.y - a.y) * 12) + (t.m - a.m);
    return Math.floor(months / spec.intervalCount);
  }
  const perStep = spec.intervalUnit === 'week' ? 7 * spec.intervalCount : spec.intervalCount;
  const days = Math.round(
    (Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000,
  );
  return Math.floor(days / perStep);
}

/**
 * The next date this routine is due.
 *
 * `from_completion` recurs from when you last did it and therefore drifts, by
 * design. `fixed` recurs on a grid pinned to `anchorDate` and does not drift -
 * but fast-forwards over a gap so a fortnight away yields ONE overdue chore,
 * never a backlog (spec Part B).
 *
 * `lastTerminalDate` is the last completed or skipped occurrence's date
 * (a completion's household-local date; a skip's `dueOn`), or null if the
 * routine has never run.
 */
export function nextDueOn(
  spec: RecurrenceSpec, lastTerminalDate: string | null, today: string,
): string {
  if (spec.mode === 'from_completion') {
    if (lastTerminalDate === null) return spec.anchorDate;
    return addInterval(lastTerminalDate, spec.intervalUnit, spec.intervalCount);
  }

  // fixed: the first slot strictly after history (or the origin itself).
  if (lastTerminalDate === null && spec.anchorDate >= today) return spec.anchorDate;
  const after = lastTerminalDate ?? addDays(spec.anchorDate, -1);

  let k = Math.max(0, estimateK(spec, after));
  // Correct the estimate in both directions - a handful of steps at most.
  while (k > 0 && slotAt(spec, k - 1) > after) k -= 1;
  while (slotAt(spec, k) <= after) k += 1;

  // Fast-forward: leave the latest slot whose SUCCESSOR is still in the future.
  while (slotAt(spec, k + 1) <= today) k += 1;

  return slotAt(spec, k);
}
