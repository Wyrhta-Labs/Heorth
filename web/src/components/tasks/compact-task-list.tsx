import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/hooks/use-formatters';
import type { Task } from '@/lib/types';

interface Props {
  tasks: Task[];
  limit?: number;
  onToggle: (task: Task) => void;
}

/**
 * Compact due-soon task rows: due date sorted ascending (undated last), capped
 * at `limit`. Built for the phone Today screen but deliberately generic
 * (no phone-specific chrome) — the Hearth wall view (Task 2.5) can reuse this
 * for its "due tasks" column instead of re-deriving the sort/cap logic.
 */
export default function CompactTaskList({ tasks, limit = 5, onToggle }: Props) {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();
  const sorted = [...tasks].sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return 0;
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });
  const shown = sorted.slice(0, limit);

  if (shown.length === 0) return <p className="text-sm text-ash py-2 text-center">{t('tasks.noOpenTasks')}</p>;

  return (
    <ul className="space-y-1.5">
      {shown.map((task) => (
        <li key={task.id} className="flex items-center gap-3 rounded-lg border border-tan bg-card px-3 py-2">
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-ember"
            checked={false}
            onChange={() => onToggle(task)}
            aria-label={t('tasks.completeAria', { title: task.title })}
          />
          <span className="flex-1 text-sm text-ink truncate">{task.title}</span>
          {task.dueAt && <span className="text-xs text-ash shrink-0">{formatDate(task.dueAt)}</span>}
        </li>
      ))}
      {tasks.length > limit && (
        <li className="text-xs text-ash text-center pt-1">{t('tasks.more', { count: tasks.length - limit })}</li>
      )}
    </ul>
  );
}
