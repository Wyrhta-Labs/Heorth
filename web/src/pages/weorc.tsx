import { useState } from 'react';
import { format } from 'date-fns';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useFormatters } from '@/hooks/use-formatters';
import * as api from '@/api/weorc';
import type { RoutineInput } from '@/api/weorc';
import { listAssets, listPlaces } from '@/api/ethel';
import type { ListResponse, RoutineView, WeorcOccurrence } from '@/lib/types';
import OccurrenceList from '@/components/weorc/occurrence-list';
import RoutineForm from '@/components/weorc/routine-form';

const ROUTINES_KEY = ['weorc', 'routines'] as const;

export default function WeorcPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { formatDate } = useFormatters();
  const qc = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RoutineView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const routinesQuery = useQuery({
    queryKey: ROUTINES_KEY,
    queryFn: () => api.listRoutines(),
  });

  // Loaded only while the form is open — the anchor picker's only consumer.
  // Fetched from @/api/ethel directly (not the shared use-ethel hooks) so it
  // can be gated on `formOpen`.
  const anchorAssetsQuery = useQuery({
    queryKey: ['weorc', 'anchorAssets'],
    queryFn: () => listAssets({ status: 'active', limit: 100 }),
    enabled: formOpen,
  });
  const anchorPlacesQuery = useQuery({
    queryKey: ['weorc', 'anchorPlaces'],
    queryFn: () => listPlaces(),
    enabled: formOpen,
  });

  /** Patches the routine whose openOccurrence just terminated, rather than
   *  relying on a refetch: the demo stack's data does not change under a
   *  refetch (nothing else materialises it), so the UI must apply the
   *  server's `next` occurrence itself. */
  function applyTerminate(occurrenceId: string, next: WeorcOccurrence | null) {
    qc.setQueryData(ROUTINES_KEY, (old: ListResponse<RoutineView> | undefined) => {
      if (!old) return old;
      return {
        ...old,
        data: old.data.map((r) => (r.openOccurrence?.id === occurrenceId ? { ...r, openOccurrence: next } : r)),
      };
    });
  }

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.completeOccurrence(id, {}),
    onSuccess: (res, id) => applyTerminate(id, res.data.next),
    onError: (e) => toast((e as Error).message || t('weorc.title'), 'error'),
  });
  const skipMutation = useMutation({
    mutationFn: (id: string) => api.skipOccurrence(id, {}),
    onSuccess: (res, id) => applyTerminate(id, res.data.next),
    onError: (e) => toast((e as Error).message || t('weorc.title'), 'error'),
  });

  const createRoutine = useMutation({
    mutationFn: (input: RoutineInput) => api.createRoutine(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROUTINES_KEY });
      setFormOpen(false);
    },
  });
  const updateRoutine = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<RoutineInput> & { active?: boolean } }) =>
      api.updateRoutine(id, input),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ROUTINES_KEY });
      setFormOpen(false);
      setEditing(null);
      // The server already had a projected open occurrence for this routine:
      // the edit takes effect from the NEXT cycle, not this one.
      if (res.data.openOccurrenceUnchanged) setNotice(t('weorc.editAppliesNextCycle'));
    },
  });

  const retry = retryOf(routinesQuery);
  if (retry) return <ErrorState message={t('common.loadFailed')} onRetry={retry} />;

  const routines = routinesQuery.data?.data ?? [];
  const today = format(new Date(), 'yyyy-MM-dd');

  const dueNow: { routine: RoutineView; occurrence: WeorcOccurrence }[] = [];
  const comingUp: { routine: RoutineView; occurrence: WeorcOccurrence }[] = [];
  for (const routine of routines) {
    if (!routine.active || !routine.openOccurrence) continue;
    const entry = { routine, occurrence: routine.openOccurrence };
    if (routine.openOccurrence.dueOn <= today) dueNow.push(entry);
    else comingUp.push(entry);
  }

  const openCreate = () => { setEditing(null); setNotice(null); setFormOpen(true); };
  const openEdit = (routine: RoutineView) => { setEditing(routine); setNotice(null); setFormOpen(true); };

  const submit = async (input: RoutineInput) => {
    try {
      if (editing) await updateRoutine.mutateAsync({ id: editing.id, input });
      else await createRoutine.mutateAsync(input);
    } catch (e) {
      toast((e as Error).message || t('weorc.title'), 'error');
    }
  };

  const deactivate = async (routine: RoutineView) => {
    try {
      await updateRoutine.mutateAsync({ id: routine.id, input: { active: false } });
    } catch (e) {
      toast((e as Error).message || t('weorc.title'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('weorc.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('weorc.subtitle')}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> {t('weorc.newRoutine')}
        </Button>
      </div>

      {notice && <p className="text-sm text-ember">{notice}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{t('weorc.dueNow')}</h2>
        <div data-testid="due-now">
          <OccurrenceList
            entries={dueNow}
            emptyMessage={t('weorc.nothingDue')}
            formatDate={formatDate}
            onComplete={(id) => completeMutation.mutate(id)}
            onSkip={(id) => skipMutation.mutate(id)}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{t('weorc.comingUp')}</h2>
        <div data-testid="coming-up">
          <OccurrenceList entries={comingUp} emptyMessage={t('weorc.nothingDue')} formatDate={formatDate} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{t('weorc.routines')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {routines.map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              expanded={!!expanded[routine.id]}
              onToggleHistory={() => setExpanded((s) => ({ ...s, [routine.id]: !s[routine.id] }))}
              onEdit={() => openEdit(routine)}
              onDeactivate={() => void deactivate(routine)}
              formatDate={formatDate}
            />
          ))}
        </div>
      </section>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('weorc.edit') : t('weorc.newRoutine')}</DialogTitle>
            <DialogClose onClose={() => setFormOpen(false)} />
          </DialogHeader>
          <RoutineForm
            routine={editing}
            assets={anchorAssetsQuery.data?.data ?? []}
            places={anchorPlacesQuery.data?.data ?? []}
            onSubmit={submit}
            onCancel={() => setFormOpen(false)}
            isLoading={createRoutine.isPending || updateRoutine.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface RoutineCardProps {
  routine: RoutineView;
  expanded: boolean;
  onToggleHistory: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  formatDate: (d: string | null | undefined) => string;
}

function RoutineCard({ routine, expanded, onToggleHistory, onEdit, onDeactivate, formatDate }: RoutineCardProps) {
  const { t } = useTranslation();
  const historyQuery = useQuery({
    queryKey: ['weorc', 'routineHistory', routine.id],
    queryFn: () => api.getRoutine(routine.id),
    enabled: expanded,
  });

  const history = [...(historyQuery.data?.data.history ?? [])].sort((a, b) =>
    (b.completedAt ?? b.dueOn).localeCompare(a.completedAt ?? a.dueOn),
  );

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          {/* Joined into ONE text node with the next-due date, deliberately -
              this routine's name already appears once in Due now/Coming up
              whenever it has an open occurrence, and a bare-name node here
              would make that text ambiguous on the page. */}
          <p className="font-medium">{routine.name} — {t('weorc.nextDue', { date: formatDate(routine.nextDueOn) })}</p>
          {!routine.active && <span className="text-xs text-ash">{t('weorc.inactive')}</span>}
        </div>
        {routine.notes && <p className="text-xs text-muted-foreground">{routine.notes}</p>}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>{t('weorc.edit')}</Button>
          {routine.active && (
            <Button variant="outline" size="sm" onClick={onDeactivate}>{t('weorc.deactivate')}</Button>
          )}
          <Button variant="ghost" size="sm" onClick={onToggleHistory}>{t('weorc.history')}</Button>
        </div>
        {expanded && (
          <ul className="space-y-1 pt-2">
            {history.length === 0 && <li className="text-xs text-muted-foreground">—</li>}
            {history.map((occ) => (
              <li key={occ.id} className="text-xs text-muted-foreground">
                {occ.status === 'completed'
                  ? t('weorc.completedOn', { date: formatDate(occ.completedAt) })
                  : t('weorc.skipped')}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
