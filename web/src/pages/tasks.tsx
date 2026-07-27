import { useState } from 'react';
import { Plus, Settings2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { useToast } from '@/components/ui/toast';
import { retryOf } from '@/lib/query-error';
import { useFormatters } from '@/hooks/use-formatters';
import {
  useTasks, useAvailableLists, useCompleteTask, useCreateTask, useSetAllowlist,
} from '@/hooks/use-tasks';
import type { Task } from '@/lib/types';

type Bucket = 'overdue' | 'soon' | 'someday';

function bucketOf(t: Task, now: number): Bucket {
  if (!t.dueAt) return 'someday';
  const due = new Date(t.dueAt).getTime();
  if (due < now) return 'overdue';
  return 'soon';
}

export default function TasksPage() {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();
  const BUCKET_LABELS: Record<Bucket, string> = {
    overdue: t('tasks.bucket.overdue'),
    soon: t('tasks.bucket.soon'),
    someday: t('tasks.bucket.someday'),
  };
  const [title, setTitle] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const { toast } = useToast();

  const openQuery = useTasks({ status: 'open' });
  const complete = useCompleteTask();
  const create = useCreateTask();

  const retry = retryOf(openQuery);
  if (retry) return <ErrorState message={t('tasks.loadError')} onRetry={retry} />;

  const tasks = openQuery.data?.data ?? [];
  const now = Date.now();
  const buckets: Record<Bucket, Task[]> = { overdue: [], soon: [], someday: [] };
  for (const task of tasks) buckets[bucketOf(task, now)].push(task);

  const onAdd = async () => {
    const value = title.trim();
    if (!value) return;
    try {
      await create.mutateAsync({ title: value });
      setTitle('');
      toast(t('capture.taskAdded'), 'success');
    } catch (e) {
      toast((e as Error).message || t('capture.couldNotAddTask'), 'error');
    }
  };

  const onToggle = async (task: Task) => {
    try {
      await complete.mutateAsync({ id: task.id, completed: true });
    } catch (e) {
      toast((e as Error).message || t('today.couldNotUpdateTask'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('tasks.pageTitle')}</h1>
        <Button variant="secondary" size="sm" onClick={() => setShowSettings((s) => !s)}>
          <Settings2 className="h-4 w-4 mr-1" /> {t('tasks.lists')}
        </Button>
      </div>

      {showSettings && <ListSettings />}

      <div className="flex gap-2">
        <Input
          placeholder={t('tasks.addPlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void onAdd(); }}
        />
        <Button onClick={() => void onAdd()} disabled={create.isPending || !title.trim()}>
          <Plus className="h-4 w-4 mr-1" /> {t('tasks.add')}
        </Button>
      </div>

      {tasks.length === 0 && (
        <p className="text-muted-foreground">{t('tasks.noOpenTasksHint')}</p>
      )}

      {(['overdue', 'soon', 'someday'] as Bucket[]).map((b) =>
        buckets[b].length > 0 ? (
          <section key={b} className="space-y-2">
            <h2 className={`text-sm font-semibold uppercase tracking-wide ${b === 'overdue' ? 'text-red-600' : 'text-muted-foreground'}`}>
              {BUCKET_LABELS[b]}
            </h2>
            <ul className="space-y-1">
              {buckets[b].map((task) => (
                <li key={task.id} className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 accent-ember"
                    checked={false}
                    onChange={() => void onToggle(task)}
                    aria-label={t('tasks.completeAria', { title: task.title })}
                  />
                  <span className="flex-1 text-sm">{task.title}</span>
                  {task.dueAt && (
                    <span className={`text-xs ${b === 'overdue' ? 'text-red-600' : 'text-muted-foreground'}`}>
                      {formatDate(task.dueAt)}
                    </span>
                  )}
                  {task.listName && (
                    <span className="text-xs rounded bg-gray-100 px-2 py-0.5 text-gray-600">{task.listName}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}

function ListSettings() {
  const { t } = useTranslation();
  const listsQuery = useAvailableLists(true);
  const setAllowlist = useSetAllowlist();
  const { toast } = useToast();

  const lists = listsQuery.data?.data ?? [];

  const toggle = async (listId: string, enabled: boolean) => {
    const next = new Set(lists.filter((l) => l.enabled).map((l) => l.id));
    if (enabled) next.add(listId); else next.delete(listId);
    try {
      await setAllowlist.mutateAsync([...next]);
      toast(t('tasks.syncedListsUpdated'), 'success');
    } catch (e) {
      toast((e as Error).message || t('tasks.couldNotUpdateLists'), 'error');
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{t('tasks.syncedListsTitle')}</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => listsQuery.refetch()} disabled={listsQuery.isFetching}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {listsQuery.isError && (
          <p className="text-sm text-red-600">
            {t('tasks.listsLoadError')}
          </p>
        )}
        {!listsQuery.isError && lists.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('tasks.noListsFound')}</p>
        )}
        {lists.map((l) => (
          <label key={l.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 accent-ember"
              checked={l.enabled}
              onChange={(e) => void toggle(l.id, e.target.checked)}
            />
            {l.name}
          </label>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          {t('tasks.syncHint')}
        </p>
      </CardContent>
    </Card>
  );
}
