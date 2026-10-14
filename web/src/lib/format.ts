import { format, parseISO, addDays, startOfWeek, type Locale } from 'date-fns';
import { enUS } from 'date-fns/locale';

/** Format a money value as currency. Locale drives separators; currency stays USD (follow-up). */
export function formatMoney(v: string | number | null | undefined, locale: Locale = enUS): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(locale.code, { style: 'currency', currency: 'USD' });
}

/** Clamp spent/budget to a 0..100 progress percentage. Budget 0 => 0%. */
export function progressPercent(spent: number, budget: number): number {
  if (!budget || budget <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((spent / budget) * 100)));
}

export function formatDate(dateStr: string | null | undefined, locale: Locale = enUS): string {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), 'PP', { locale }); } catch { return dateStr; }
}

/** Clock time of an instant — in `timeZone` when given (the household's), else the browser's. */
export function formatTime(dateStr: string | null | undefined, locale: Locale = enUS, timeZone?: string): string {
  if (!dateStr) return '—';
  try {
    const d = parseISO(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return timeZone ? formatClock(d, timeZone, locale, 'p') : format(d, 'p', { locale });
  } catch { return dateStr; }
}

/**
 * The 7 Date objects of the week containing `ref`, Monday first in every
 * locale — the week every range and fetch window in the app uses
 * (`weekStartsOn: 1`), so the columns can never drift from the data.
 */
export function weekDays(ref: Date = new Date()): Date[] {
  const first = startOfWeek(ref, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

export function dayLabel(d: Date, locale: Locale = enUS): { dow: string; dom: string; iso: string } {
  // iso is a data key — NEVER localized.
  return { dow: format(d, 'EEE', { locale }), dom: format(d, 'd'), iso: format(d, 'yyyy-MM-dd') };
}

// Intl.DateTimeFormat construction is costly and the wall buckets every event,
// task and reminder per day cell, so keep one formatter per zone.
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
function cachedFormat(cache: Map<string, Intl.DateTimeFormat>, timeZone: string, make: () => Intl.DateTimeFormat) {
  let f = cache.get(timeZone);
  if (!f) { f = make(); cache.set(timeZone, f); }
  return f;
}

/**
 * Today's calendar date (`YYYY-MM-DD`) as a given IANA zone reckons it — the
 * client-side counterpart of the server's `householdToday()`. Uses
 * `Intl.DateTimeFormat` rather than the browser's own zone, so a page that
 * splits "due now" from "coming up" agrees with the backend near midnight
 * instead of drifting a day out whenever the browser and household differ.
 */
export function todayInTimeZone(timeZone: string, ref: Date = new Date()): string {
  const parts = cachedFormat(dateFormats, timeZone, () => new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  })).formatToParts(ref);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The wall-clock fields of instant `ref` as `timeZone` reads them. */
function zonedFields(ref: Date, timeZone: string) {
  const parts = cachedFormat(dateTimeFormats, timeZone, () => new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })).formatToParts(ref);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** How far `timeZone`'s wall clock runs ahead of UTC at instant `ms`, in ms. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const f = zonedFields(new Date(ms), timeZone);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which calendar day `iso` (`YYYY-MM-DD`) begins in `timeZone` —
 * the household-zone counterpart of `startOfDay`, for building API windows
 * whose bounds are instants. Two passes so a day that starts on the far side of
 * a DST change still lands on its own offset.
 */
export function startOfDayInTimeZone(iso: string, timeZone: string): Date {
  return instantFromWallClock(`${iso}T00:00`, timeZone);
}

/**
 * The instant at which `timeZone`'s wall clock reads `local`
 * (`YYYY-MM-DDTHH:mm`, a `datetime-local` value).
 *
 * Around a DST change a wall time can be ambiguous or missing:
 * - **fold** (clocks go back, the time happens twice): the EARLIER instant.
 *   That is the first time the wall reads it, the convention of RFC 5545 and
 *   of Temporal's default `'compatible'` disambiguation, and what
 *   `wallClockInput` of that first instant must round-trip to.
 * - **gap** (clocks jump forward, the time never happens): the FIRST VALID
 *   instant after it, i.e. the transition itself. So a day whose midnight is
 *   skipped (America/Santiago in September) starts at its first real instant.
 *
 * Candidates come from the offsets a day either side, each checked against
 * the zone's actual wall fields; transitions closer than that are not handled.
 */
export function instantFromWallClock(local: string, timeZone: string): Date {
  const [datePart, timePart = '00:00'] = local.split('T');
  const [y, m, d] = datePart!.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const wall = Date.UTC(y!, m! - 1, d!, h ?? 0, mi ?? 0);
  const DAY = 86_400_000;
  const before = zoneOffsetMs(wall - DAY, timeZone);
  const after = zoneOffsetMs(wall + DAY, timeZone);
  const valid = [wall - before, wall - after].filter((t) => t + zoneOffsetMs(t, timeZone) === wall);
  if (valid.length > 0) return new Date(Math.min(...valid));
  // Gap: the transition lies between the two candidates; find its first
  // instant (offsets change on whole seconds).
  let lo = wall - after; // still on the old offset
  let hi = wall - before; // already on the new one
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
    if (zoneOffsetMs(mid, timeZone) === after) hi = mid; else lo = mid;
  }
  return new Date(hi);
}

/** Calendar date `iso` (`YYYY-MM-DD`) moved by `days` — pure date arithmetic, no zone involved. */
export function addDaysIso(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), 'yyyy-MM-dd');
}

/** The seven dates (`YYYY-MM-DD`) of the Monday-first week containing date `iso` — pure date arithmetic. */
export function weekOfIso(iso: string): string[] {
  const first = startOfWeek(parseISO(iso), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => format(addDays(first, i), 'yyyy-MM-dd'));
}

/**
 * The inclusive instant window (ISO-8601, UTC) covering household days
 * `fromDay` through `toDay`: `fromDay`'s midnight in `timeZone` up to the
 * millisecond before the midnight that follows `toDay` — the shape the
 * events/tasks validators take (datetimes, compared inclusively).
 */
export function dayWindowInTimeZone(fromDay: string, toDay: string, timeZone: string): { from: string; to: string } {
  return {
    from: startOfDayInTimeZone(fromDay, timeZone).toISOString(),
    to: new Date(startOfDayInTimeZone(addDaysIso(toDay, 1), timeZone).getTime() - 1).toISOString(),
  };
}

/** `ref` as a `datetime-local` value (`YYYY-MM-DDTHH:mm`) on `timeZone`'s wall clock. */
export function wallClockInput(ref: Date, timeZone: string): string {
  const f = zonedFields(ref, timeZone);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${f.year}-${p(f.month)}-${p(f.day)}T${p(f.hour)}:${p(f.minute)}`;
}

/**
 * The clock time of instant `ref` on `timeZone`'s wall clock, formatted from
 * Intl's zone-aware fields — never via a browser-local Date built from those
 * fields, which a browser DST gap would shift by an hour. `'HH:mm'` is the
 * fixed 24-hour form; `'p'` follows the locale's clock like date-fns' `p`
 * ("8:05 AM" in en-US, "08:05" in en-GB/de).
 */
export function formatClock(ref: Date, timeZone: string, locale: Locale = enUS, pattern: 'HH:mm' | 'p' = 'HH:mm'): string {
  const f = zonedFields(ref, timeZone);
  const mm = String(f.minute).padStart(2, '0');
  if (pattern === 'HH:mm' || !uses12HourClock(locale)) return `${String(f.hour).padStart(2, '0')}:${mm}`;
  const period = cachedFormat(dayPeriodFormats, locale.code ?? 'en-US', () => new Intl.DateTimeFormat(locale.code, { hour: 'numeric', hourCycle: 'h12', timeZone: 'UTC' }))
    .formatToParts(new Date(Date.UTC(2000, 0, 1, f.hour))).find((p) => p.type === 'dayPeriod')?.value ?? (f.hour < 12 ? 'AM' : 'PM');
  return `${f.hour % 12 || 12}:${mm} ${period}`;
}

const dayPeriodFormats = new Map<string, Intl.DateTimeFormat>();
const hourCycles = new Map<string, boolean>();
function uses12HourClock(locale: Locale): boolean {
  const code = locale.code ?? 'en-US';
  let h12 = hourCycles.get(code);
  if (h12 === undefined) {
    const cycle = new Intl.DateTimeFormat(code, { hour: 'numeric' }).resolvedOptions().hourCycle;
    h12 = cycle === 'h12' || cycle === 'h11';
    hourCycles.set(code, h12);
  }
  return h12;
}
