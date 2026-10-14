import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import { todayInTimeZone } from '@/lib/format';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
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

/** The four nav counts. Same query keys and functions as the pages, so the
 *  cache is shared and the pages' invalidations refresh the badges. */
export function useNavCounts(): NavCounts {
  // The Weorc key and the due-task count depend on the household's date: no
  // browser-zone query goes out and nothing is counted until its zone is known.
  const { zone: timeZone, ready } = useHouseholdZone();
  const today = useHouseholdToday(timeZone);
  const openTasks = { status: 'open' } as const;

  const tasksQ = useQuery({ queryKey: [...QUERY_KEYS.tasks, openTasks], queryFn: () => tasks.listTasks(openTasks), ...BADGE_QUERY });
  const shoppingQ = useQuery({ queryKey: QUERY_KEYS.shoppingList, queryFn: () => meals.listShoppingItems(), ...BADGE_QUERY });
  const weorcQ = useQuery({
    queryKey: QUERY_KEYS.weorcNavDue(today),
    queryFn: () => weorc.listOccurrences({ status: 'due', due_to: today }),
    ...BADGE_QUERY,
    enabled: ready,
  });
  const feohQ = useQuery({ queryKey: QUERY_KEYS.importStatus, queryFn: () => feohImport.getImportStatus(), ...BADGE_QUERY });

  return {
    tasks: ready && tasksQ.data ? countDueTasks(tasksQ.data.data, timeZone, new Date()) : undefined,
    shopping: shoppingQ.data ? shoppingQ.data.data.filter((i) => !i.checked).length : undefined,
    weorc: weorcQ.data?.meta.total,
    feoh: feohQ.data?.data.pendingCount,
  };
}
