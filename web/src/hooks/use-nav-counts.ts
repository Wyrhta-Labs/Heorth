import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import { todayInTimeZone } from '@/lib/format';
import { useHousehold } from '@/hooks/use-household';
import * as tasks from '@/api/tasks';
import * as meals from '@/api/meals';
import * as weorc from '@/api/weorc';
import * as feohImport from '@/api/feoh-import';
import type { Task } from '@/lib/types';
import type { NavCounts } from '@/components/layout/sidebar';

/** Badges are decoration on the nav: fetched rarely, never retried, never
 *  surfaced as an error. A 401 still logs out - that happens in the API client. */
const BADGE_QUERY = { staleTime: 5 * 60_000, retry: false } as const;

/** Open tasks whose due date, read in the household's zone, is today or earlier. */
export function countDueTasks(list: Task[], timeZone: string, now: Date = new Date()): number {
  const today = todayInTimeZone(timeZone, now);
  return list.filter((t) => t.dueAt != null && todayInTimeZone(timeZone, new Date(t.dueAt)) <= today).length;
}

/** How often the household date is re-read. A tick (not a timeout to midnight)
 *  stays correct across DST shifts and zone changes. */
const DATE_TICK_MS = 30_000;

/** The household's current date, re-read on a timer so a shell left open
 *  across midnight rolls over (the Weorc key and the task comparison depend on it). */
function useHouseholdToday(timeZone: string): string {
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

/** The four nav counts. Same query keys and functions as the pages, so the
 *  cache is shared and the pages' invalidations refresh the badges. */
export function useNavCounts(): NavCounts {
  const timeZone = useHousehold().data?.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = useHouseholdToday(timeZone);
  const openTasks = { status: 'open' } as const;

  const tasksQ = useQuery({ queryKey: [...QUERY_KEYS.tasks, openTasks], queryFn: () => tasks.listTasks(openTasks), ...BADGE_QUERY });
  const shoppingQ = useQuery({ queryKey: QUERY_KEYS.shoppingList, queryFn: () => meals.listShoppingItems(), ...BADGE_QUERY });
  const weorcQ = useQuery({
    queryKey: QUERY_KEYS.weorcNavDue(today),
    queryFn: () => weorc.listOccurrences({ status: 'due', due_to: today }),
    ...BADGE_QUERY,
  });
  const feohQ = useQuery({ queryKey: QUERY_KEYS.importStatus, queryFn: () => feohImport.getImportStatus(), ...BADGE_QUERY });

  return {
    tasks: tasksQ.data ? countDueTasks(tasksQ.data.data, timeZone, new Date()) : undefined,
    shopping: shoppingQ.data ? shoppingQ.data.data.filter((i) => !i.checked).length : undefined,
    weorc: weorcQ.data?.meta.total,
    feoh: feohQ.data?.data.pendingCount,
  };
}
