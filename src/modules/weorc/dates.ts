import { getHouseholdTimeZone } from '../../household/timezone.js';
import { localDateOf, zonedMidnightUtc } from '../../lib/local-date.js';

/**
 * Weorc's only clock. Chores are day-grained and the day that matters is the
 * HOUSEHOLD's, not the server's - Heorth may run on a UTC host while the
 * household lives in Europe/Berlin, and every date boundary would then be a day
 * out for half the evening.
 *
 * Deliberately NOT `localTodayIso()` (src/modules/feoh/dates.ts): that helper is
 * server-local, which is only accidentally the household's zone.
 */

/** Today's calendar date as the household reckons it (`YYYY-MM-DD`). */
export async function householdToday(): Promise<string> {
  return localDateOf(new Date(), await getHouseholdTimeZone());
}

/** The UTC instant of household-local midnight of `dueOn` - DST-correct,
 *  matching `MirroredTask.dueAt`'s stated semantics. */
export async function householdMidnightUtc(dueOn: string): Promise<Date> {
  return zonedMidnightUtc(dueOn, await getHouseholdTimeZone());
}
