import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { addDaysIso } from '@/lib/format';
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
 */
export default function DueWork() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { formatDate } = useFormatters();
  const qc = useQueryClient();

  const { zone } = useHouseholdZone();
  const tomorrow = addDaysIso(useHouseholdToday(zone), 1);

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
    .filter((r) => r.active && r.openOccurrence && r.openOccurrence.dueOn <= tomorrow)
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
        ) : (
          <>
            <OccurrenceList
              entries={chores.slice(0, CHORE_LIMIT)}
              emptyMessage={t('dashboard.work.noChores')}
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
          <CompactTaskList tasks={tasksQuery.data?.data ?? []} onToggle={(task) => void onToggleTask(task)} />
        )}
      </section>
    </div>
  );
}
