export const CADENCES = ['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'] as const;
export type Cadence = (typeof CADENCES)[number];
export function isCadence(s: string): s is Cadence { return (CADENCES as readonly string[]).includes(s); }

const MONTH_STEPS: Record<Exclude<Cadence, 'weekly'>, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

function parts(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.split('-').map(Number);
  return { y: y!, m: m!, day: day! };
}
function fmt(y: number, m: number, day: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function daysInMonth(y: number, m: number): number { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/** nth occurrence date after the anchor. Month-family cadences derive each
 *  date from the ANCHOR's day-of-month (clamped per target month) — never
 *  from the previous clamped date, so Jan 31 -> Feb 28 -> Mar 31. */
export function addPeriods(anchor: string, cadence: Cadence, n: number): string {
  const a = parts(anchor);
  if (cadence === 'weekly') {
    const d = new Date(Date.UTC(a.y, a.m - 1, a.day + 7 * n));
    return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const totalMonths = a.y * 12 + (a.m - 1) + MONTH_STEPS[cadence] * n;
  const y = Math.floor(totalMonths / 12);
  const m = (totalMonths % 12) + 1;
  return fmt(y, m, Math.min(a.day, daysInMonth(y, m)));
}

export function projectDueDates(anchor: string, cadence: Cadence, toInclusive: string): string[] {
  const out: string[] = [];
  for (let n = 0; ; n++) {
    const d = addPeriods(anchor, cadence, n);
    if (d > toInclusive) break;
    out.push(d);
  }
  return out;
}

export function isProjectedDate(anchor: string, cadence: Cadence, dueDate: string): boolean {
  if (dueDate < anchor) return false;
  for (let n = 0; ; n++) {
    const d = addPeriods(anchor, cadence, n);
    if (d === dueDate) return true;
    if (d > dueDate) return false;
  }
}
