import { getHousehold } from './service.js';

/**
 * Resolve the household's IANA timezone for date-semantics conversions (e.g.
 * the M365 To Do provider's calendar-date handling). Falls back to 'UTC' when
 * the household row is missing/empty, and when the stored zone is unknown to
 * `Intl` (warned once, not per call). Writes are now constrained to
 * `SUPPORTED_TIMEZONES` (see `options.ts`), but rows predating that validation
 * may still hold free text, so the guard stays. It deliberately tests `Intl`
 * resolvability rather than list membership: a legacy alias such as
 * `Asia/Kolkata` may be absent from this ICU's `supportedValuesOf` list yet
 * still convert correctly.
 */

let warnedInvalidZone: string | null = null;

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export async function getHouseholdTimeZone(): Promise<string> {
  const row = await getHousehold();
  const zone = row?.timezone?.trim();
  if (!zone) return 'UTC';
  if (!isValidZone(zone)) {
    if (warnedInvalidZone !== zone) {
      warnedInvalidZone = zone;
      console.warn(`household timezone "${zone}" is not a valid IANA zone — falling back to UTC`);
    }
    return 'UTC';
  }
  return zone;
}
