import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import {
  addWeeks, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format,
} from 'date-fns';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { ApiError } from '@/api/client';
import HearthWeek from '@/components/hearth/hearth-week';
import HearthMonth from '@/components/hearth/hearth-month';
import NowNextStrip from '@/components/hearth/now-next-strip';
import RecipeOverlay from '@/components/hearth/recipe-overlay';
import { useIdle } from '@/components/hearth/use-idle';
import { useEvents } from '@/hooks/use-calendar';
import { useTasks, useCompleteTask } from '@/hooks/use-tasks';
import { useWeekPlan, useRecipes, useUpsertPlanEntry, useDeletePlanEntry } from '@/hooks/use-meals';
import { useHouseholdMembers } from '@/hooks/use-household';
import { useM365Status } from '@/hooks/use-m365';
import { useFormatters } from '@/hooks/use-formatters';
import {
  composeDay, computeMealSwap, deriveStaleness, tasksForDay, formatAge,
  type DayComposition, type MealOp,
} from '@/lib/hearth';
import type { EventOccurrence, Member, Recipe, Task } from '@/lib/types';

// Polling cadences for the always-on wall. Tasks poll fastest so a completion
// (here or from a phone via To Do sync) strikes through within a cycle.
const POLL_TASKS = 30_000;
const POLL_EVENTS = 60_000;
const POLL_MEALS = 120_000;
const GC = 10 * 60_000; // cap retained (paged-away) week/month query pages

function HearthInner() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { weekDays, dayLabel, locale } = useFormatters();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [openRecipeId, setOpenRecipeId] = useState<string | null>(null);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const idle = useIdle();

  // Ticking clock (30s) — drives now/next and the header time without a busy loop.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const now = new Date(nowMs);
  const todayIso = dayLabel(now).iso;

  // Visible range depends on the mode + paging offset.
  const base = view === 'week' ? addWeeks(now, weekOffset) : addMonths(now, monthOffset);
  const rangeFrom = view === 'week' ? startOfWeek(base, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(base), { weekStartsOn: 1 });
  const rangeTo = view === 'week' ? endOfWeek(base, { weekStartsOn: 1 }) : endOfWeek(endOfMonth(base), { weekStartsOn: 1 });
  const fromIso = rangeFrom.toISOString();
  const toIso = rangeTo.toISOString();
  const fromDay = format(rangeFrom, 'yyyy-MM-dd');
  const toDay = format(rangeTo, 'yyyy-MM-dd');

  const eventsQuery = useEvents({ from: fromIso, to: toIso }, { refetchInterval: POLL_EVENTS, gcTime: GC, placeholderData: keepPreviousData });
  // Full instants, not fromDay/toDay: the tasks validator requires ISO
  // datetimes (date-only 400s, #3), and the local week boundaries match the
  // local-day bucketing used on the display side (lib/hearth.ts isoOf).
  const tasksQuery = useTasks({ due_from: fromIso, due_to: toIso }, { refetchInterval: POLL_TASKS, gcTime: GC, placeholderData: keepPreviousData });
  const planQuery = useWeekPlan(fromDay, toDay, { refetchInterval: POLL_MEALS, gcTime: GC, placeholderData: keepPreviousData });
  const recipesQuery = useRecipes();
  const membersQuery = useHouseholdMembers();
  const statusQuery = useM365Status();
  const complete = useCompleteTask();
  const upsertMeal = useUpsertPlanEntry();
  const deleteMeal = useDeletePlanEntry();

  const occurrences = (eventsQuery.data?.data ?? []) as EventOccurrence[];
  const tasks = tasksQuery.data?.data ?? [];
  const entries = planQuery.data?.data ?? [];
  const recipes = recipesQuery.data?.data ?? [];
  const members = membersQuery.data?.data ?? [];
  const feeds = statusQuery.data ?? [];

  const membersById = useMemo(() => Object.fromEntries(members.map((m: Member) => [m.id, m])), [members]);
  const recipesById = useMemo(() => Object.fromEntries(recipes.map((r: Recipe) => [r.id, r])), [recipes]);
  const staleByOwner = useMemo(() => deriveStaleness(feeds, nowMs), [feeds, nowMs]);

  // Prune optimistic "completing" ids once the server confirms them completed,
  // so the set stays bounded across an all-day session.
  useEffect(() => {
    if (completingIds.size === 0) return;
    const stillPending = new Set(
      [...completingIds].filter((id) => tasks.find((t) => t.id === id)?.status !== 'completed'),
    );
    if (stillPending.size !== completingIds.size) setCompletingIds(stillPending);
  }, [tasks, completingIds]);

  const days: DayComposition[] = useMemo(() => {
    if (view !== 'week') return [];
    return weekDays(base).map((d) => {
      const iso = dayLabel(d).iso;
      return composeDay(iso, occurrences, entries, tasks, todayIso, completingIds);
    });
  }, [view, base, occurrences, entries, tasks, todayIso, completingIds]);

  const todayComposition = composeDay(todayIso, occurrences, entries, tasks, todayIso, completingIds);
  const dueTodayCount = tasksForDay(tasks, todayIso, todayIso, completingIds).open.length;

  const onCompleteTask = async (task: Task) => {
    setCompletingIds((prev) => new Set(prev).add(task.id));
    try {
      await complete.mutateAsync({ id: task.id, completed: true });
    } catch (e) {
      setCompletingIds((prev) => { const n = new Set(prev); n.delete(task.id); return n; });
      toast(transientMessage(e, t), 'error');
    }
  };

  const onSwapMeal = async (fromDate: string, toDate: string) => {
    const ops: MealOp[] = computeMealSwap(entries, fromDate, toDate);
    if (ops.length === 0) return;
    try {
      for (const op of ops) {
        if (op.type === 'upsert') await upsertMeal.mutateAsync(op.input);
        else await deleteMeal.mutateAsync(op.id);
      }
    } catch {
      toast(t('hearth.errors.moveMeal'), 'error');
    }
  };

  const openRecipe = openRecipeId ? recipesById[openRecipeId] : undefined;

  // Freshness: the oldest successful update among the core queries, and whether
  // any is currently erroring (so we show "reconnecting" rather than blank).
  const updatedAt = Math.min(
    eventsQuery.dataUpdatedAt || nowMs,
    tasksQuery.dataUpdatedAt || nowMs,
    planQuery.dataUpdatedAt || nowMs,
  );
  const reconnecting = eventsQuery.isError || tasksQuery.isError || planQuery.isError;

  // Human-readable staleness notes: "<member>'s calendar — last synced 2h ago".
  const staleNotes = Object.entries(staleByOwner)
    .filter(([, s]) => s.stale)
    .map(([owner, s]) => {
      const who = owner === 'family' ? t('hearth.stale.family') : (membersById[owner]?.displayName ?? t('hearth.stale.someone'));
      const age = formatAge(s.lastSuccessAt, nowMs, t);
      return s.needsReauth
        ? t('hearth.stale.reconnect', { who })
        : t('hearth.stale.lastSynced', { who, age });
    });

  const label = view === 'week'
    ? `${format(rangeFrom, t('hearth.header.rangePattern'), { locale })} – ${format(rangeTo, t('hearth.header.rangePattern'), { locale })}`
    : format(base, t('hearth.header.monthPattern'), { locale });
  const offset = view === 'week' ? weekOffset : monthOffset;
  const page = (delta: number) => (view === 'week' ? setWeekOffset((o) => o + delta) : setMonthOffset((o) => o + delta));
  const resetPage = () => (view === 'week' ? setWeekOffset(0) : setMonthOffset(0));

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-parchment px-8 py-6 hearth-drift">
      {/* Header */}
      <header className="mb-5 flex items-end justify-between gap-6">
        <div>
          <h1 className="font-serif text-5xl leading-none text-ink">{format(now, 'EEEE', { locale })}</h1>
          <p className="mt-1 text-xl text-ash">{format(now, t('hearth.header.datePattern'), { locale })} · {format(now, 'HH:mm')}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl border border-tan bg-card p-1">
              {(['week', 'month'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-lg px-5 py-2 text-lg ${view === v ? 'bg-ember text-white' : 'text-ash'}`}
                >
                  {t(v === 'week' ? 'hearth.view.week' : 'hearth.view.month')}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => page(-1)} aria-label={t('hearth.nav.previous')} className="flex h-11 w-11 items-center justify-center rounded-full border border-tan bg-card text-ink">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <span className="min-w-56 text-center font-serif text-2xl text-ink">{label}</span>
            <button onClick={() => page(1)} aria-label={t('hearth.nav.next')} className="flex h-11 w-11 items-center justify-center rounded-full border border-tan bg-card text-ink">
              <ChevronRight className="h-6 w-6" />
            </button>
            {offset !== 0 && (
              <button onClick={resetPage} aria-label={t('hearth.nav.backToToday')} className="flex h-11 w-11 items-center justify-center rounded-full border border-tan bg-card text-ash">
                <RotateCcw className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Today's focus band (only meaningful on the current week/month) */}
      {offset === 0 && (
        <div className="mb-5">
          <NowNextStrip
            todayOccurrences={todayComposition.events}
            supper={todayComposition.supper}
            dueTodayCount={dueTodayCount}
            nowMs={nowMs}
            membersById={membersById}
            recipesById={recipesById}
          />
        </div>
      )}

      {/* Main surface */}
      {view === 'week' ? (
        <HearthWeek
          days={days}
          todayIso={todayIso}
          membersById={membersById}
          recipesById={recipesById}
          staleByOwner={staleByOwner}
          completingIds={completingIds}
          onCompleteTask={onCompleteTask}
          onOpenRecipe={setOpenRecipeId}
          onSwapMeal={onSwapMeal}
        />
      ) : (
        <HearthMonth
          year={base.getFullYear()}
          month0={base.getMonth()}
          todayIso={todayIso}
          occurrences={occurrences}
          entries={entries}
          tasks={tasks}
          membersById={membersById}
          recipesById={recipesById}
          staleByOwner={staleByOwner}
        />
      )}

      {/* Freshness / staleness footer */}
      <footer className="mt-4 flex items-center justify-between gap-6 text-sm text-ash/80">
        <span className="shrink-0">
          {reconnecting ? t('hearth.footer.reconnecting') : ''}{t('hearth.footer.asOf', { time: format(new Date(updatedAt), 'HH:mm') })}
        </span>
        {staleNotes.length > 0 && (
          <span className="truncate text-right">{staleNotes.join('   ·   ')}</span>
        )}
      </footer>

      {/* Recipe reading overlay */}
      {openRecipe && <RecipeOverlay recipe={openRecipe} onClose={() => setOpenRecipeId(null)} />}

      {/* Idle dim (screen-burn friendly) — any touch clears it via useIdle */}
      {idle && !openRecipe && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-ink/40 transition-opacity duration-1000" aria-hidden />
      )}
    </div>
  );
}

/** Gentle, human wording for a completion failure — never a stack trace. */
function transientMessage(e: unknown, t: TFunction): string {
  if (e instanceof ApiError) {
    if (e.status === 502 || e.status === 503) return t('hearth.errors.graphDown');
    if (e.code === 'NEEDS_REAUTH' || e.code === 'NO_CONNECTION') return t('hearth.errors.needsReconnect');
  }
  return t('hearth.errors.updateTask');
}

export default function HearthPage() {
  // The wall has its own ToastProvider (it does not render inside AppShell, which
  // provides the app's toasts).
  return (
    <ToastProvider>
      <HearthInner />
    </ToastProvider>
  );
}
