import { format, parseISO, addDays, startOfWeek, startOfDay, endOfDay } from 'date-fns';

/** Format a money value (string from raw rows, or number from summaries) as USD. */
export function formatMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Clamp spent/budget to a 0..100 progress percentage. Budget 0 => 0%. */
export function progressPercent(spent: number, budget: number): number {
  if (!budget || budget <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((spent / budget) * 100)));
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), 'MMM d, yyyy'); } catch { return dateStr; }
}

export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), 'h:mm a'); } catch { return dateStr; }
}

/** The 7 Date objects of the week containing `ref` (Monday-first). */
export function weekDays(ref: Date = new Date()): Date[] {
  const monday = startOfWeek(ref, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function dayLabel(d: Date): { dow: string; dom: string; iso: string } {
  return { dow: format(d, 'EEE'), dom: format(d, 'd'), iso: format(d, 'yyyy-MM-dd') };
}

/**
 * The start/end instants (ISO-8601, UTC) bracketing the LOCAL calendar day
 * containing `d`. Built from local midnight/end-of-day so a negative-UTC
 * viewer's "today" window is not shifted into the previous day (which a naive
 * `${yyyy-MM-dd}T00:00:00Z` construction would cause).
 */
export function dayRangeIso(d: Date = new Date()): { from: string; to: string } {
  return { from: startOfDay(d).toISOString(), to: endOfDay(d).toISOString() };
}
