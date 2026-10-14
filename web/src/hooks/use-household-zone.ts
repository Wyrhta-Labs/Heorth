import { useEffect, useRef, useState } from 'react';
import { todayInTimeZone } from '@/lib/format';
import { useHousehold } from '@/hooks/use-household';

/** The browser's own IANA zone — only ever the stand-in for the household's. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface HouseholdZone {
  /** The zone every date on screen is read in: the household's, or the browser's as a fallback. */
  zone: string;
  /** The household's own zone is in hand. */
  known: boolean;
  /** /household failed and the browser's zone stands in. */
  failed: boolean;
  /** `known || failed`: date-shaped fetches and views may go ahead. */
  ready: boolean;
}

/**
 * The household's time zone, the one every date-shaped thing in the app is
 * read in — not the browser's. While /household loads, `ready` is false and
 * callers fetch and show nothing date-shaped (a browser-zone week would go out
 * first and flash). Only if /household fails does the browser zone stand in.
 */
export function useHouseholdZone(): HouseholdZone {
  const household = useHousehold();
  const known = household.data !== undefined;
  const failed = !known && household.isError;
  return { zone: household.data?.data.timezone ?? browserTimeZone(), known, failed, ready: known || failed };
}

/** How often the household date is re-read. A tick (not a timeout to midnight)
 *  stays correct across DST shifts and zone changes. */
const DATE_TICK_MS = 30_000;

/** The household's current date (`YYYY-MM-DD`) in `timeZone`, re-read on a
 *  timer so a page left open across midnight rolls over. */
export function useHouseholdToday(timeZone: string): string {
  const [, setTick] = useState(0);
  const last = useRef('');
  const today = todayInTimeZone(timeZone);
  last.current = today;
  useEffect(() => {
    const id = setInterval(() => {
      if (todayInTimeZone(timeZone) !== last.current) setTick((n) => n + 1);
    }, DATE_TICK_MS);
    return () => clearInterval(id);
  }, [timeZone]);
  return today;
}
