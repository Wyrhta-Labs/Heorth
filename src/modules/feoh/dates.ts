/** Server-LOCAL calendar date (not UTC) — shared by item-costs.ts (lifetime
 *  end) and ledger.ts (Kassensturz "today" cutoff) so both derive "today" the
 *  same way. `toISOString()` would be UTC and misclassify dates around local
 *  midnight. */
export function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
