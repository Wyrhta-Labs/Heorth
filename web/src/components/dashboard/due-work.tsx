import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { addDaysIso } from '@/lib/format';
import { keepHighlighted } from '@/lib/day-focus';
import { useFormatters } from '@/hooks/use-formatters';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import { useTasks, useCompleteTask } from '@/hooks/use-tasks';
import * as weorc from '@/api/weorc';
import OccurrenceList, { type OccurrenceEntry } from '@/components/weorc/occurrence-list';
import CompactTaskList from '@/components/tasks/compact-task-list';
import type { Task } from '@/lib/types';

// Shared with the Weorc page, so completing a chore here refreshes it there.
const ROUTINES_KEY = ['weorc', 'routines'] as const;
const CHORE_LIMIT = 5;

/**
 * What needs doing: chores whose open occurrence is due by tomorrow (overdue
 * ones included), then the open tasks. "Today" is the household's date, as on
 * the Weorc page, so both agree near midnight.
 *
 * With `day` (the start page's focused day) the chores run through that day if
 * it is later than tomorrow, and the chores and tasks due on it are highlighted.
 */
export default function DueWork({ day }: { day?: string } = {}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { formatDate } = useFormatters();
  const qc = useQueryClient();

  // Chores are split by the household's tomorrow: none are listed until its zone is known.
  const { zone, ready } = useHouseholdZone();
  const tomorrow = addDaysIso(useHouseholdToday(zone), 1);
  const through = day && day > tomorrow ? day : tomorrow;

  const routinesQuery = useQuery({ queryKey: ROUTINES_KEY, queryFn: () => weorc.listRoutines() });
  const tasksQuery = useTasks({ status: 'open' });
  const completeTask = useCompleteTask();
  const completeChore = useMutation({
    mutationFn: (id: string) => weorc.completeOccurrence(id, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ROUTINES_KEY }),
    onError: (e) => toast((e as Error).message || t('today.couldNotUpdateTask'), 'error'),
  });

  const onToggleTask = async (task: Task) => {
    try {
      await completeTask.mutateAsync({ id: task.id, completed: true });
    } catch (e) {
      toast((e as Error).message || t('today.couldNotUpdateTask'), 'error');
    }
  };

  const chores: OccurrenceEntry[] = (routinesQuery.data?.data ?? [])
    .filter((r) => r.active && r.openOccurrence && r.openOccurrence.dueOn <= through)
    .map((r) => ({ routine: r, occurrence: r.openOccurrence! }))
    .sort((a, b) => a.occurrence.dueOn.localeCompare(b.occurrence.dueOn));

  const choresRetry = retryOf(routinesQuery);
  const tasksRetry = retryOf(tasksQuery);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ash">{t('dashboard.work.chores')}</h3>
        {choresRetry ? (
          <ErrorState compact message={t('common.loadFailed')} onRetry={choresRetry} />
        ) : !ready || !routinesQuery.data ? (
          <p className="text-sm text-ash py-2 text-center" aria-busy="true">{t('common.loading')}</p>
        ) : (
          <>
            <OccurrenceList
              entries={day ? keepHighlighted(chores, CHORE_LIMIT, (c) => c.occurrence.dueOn === day) : chores.slice(0, CHORE_LIMIT)}
              emptyMessage={through === tomorrow ? t('dashboard.work.noChores') : t('dashboard.work.noChoresThrough', { day: formatDate(through) })}
              highlightDueOn={day}
              confirmComplete
              formatDate={formatDate}
              onComplete={(id) => completeChore.mutate(id)}
              showProjectionProblem={false}
            />
            {chores.length > CHORE_LIMIT && (
              <p className="text-xs text-ash text-center">{t('tasks.more', { count: chores.length - CHORE_LIMIT })}</p>
            )}
          </>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ash">{t('dashboard.work.tasks')}</h3>
        {tasksRetry ? (
          <ErrorState compact message={t('tasks.loadError')} onRetry={tasksRetry} />
        ) : (
          <CompactTaskList tasks={tasksQuery.data?.data ?? []} onToggle={(task) => void onToggleTask(task)} highlightDay={day} />
        )}
      </section>
    </div>
  );
}
