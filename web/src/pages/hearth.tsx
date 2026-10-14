import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import {
  addDays, addWeeks, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, parseISO,
} from 'date-fns';
import { ChevronLeft, ChevronRight, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { TFunction } from 'i18next';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { ApiError } from '@/api/client';
import HearthWeek from '@/components/hearth/hearth-week';
import HearthMonth from '@/components/hearth/hearth-month';
import NowNextStrip from '@/components/hearth/now-next-strip';
import RecipeOverlay from '@/components/hearth/recipe-overlay';
import AddEventOverlay from '@/components/hearth/add-event-overlay';
import DisplayPrefsModal from '@/components/hearth/display-prefs-modal';
import { useIdle } from '@/components/hearth/use-idle';
import { useEvents } from '@/hooks/use-calendar';
import { useTasks, useCompleteTask } from '@/hooks/use-tasks';
import { useWeekPlan, useUpsertPlanEntry, useDeletePlanEntry } from '@/hooks/use-meals';
import { useHousehold, useHouseholdMembers } from '@/hooks/use-household';
import { useIntegrationsFeedStatus } from '@/hooks/use-m365';
import { useFeatures } from '@/hooks/use-features';
import { useKithReminders } from '@/hooks/use-kith';
import { useFormatters } from '@/hooks/use-formatters';
import {
  loadHearthDisplayPrefs, saveHearthDisplayPrefs, loadHearthPosition, saveHearthPosition,
} from '@/lib/hearth-prefs';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { formatClock, startOfDayInTimeZone, todayInTimeZone } from '@/lib/format';
import {
  composeDay, computeMealSwap, deriveStaleness, tasksForDay, formatAge,
  type DayComposition, type MealOp,
} from '@/lib/hearth';
import type { EventOccurrence, KithReminder, Member, Recipe, Task } from '@/lib/types';

// Polling cadences for the always-on wall. Tasks poll fastest so a completion
// (here or from a phone via To Do sync) strikes through within a cycle.
const POLL_TASKS = 30_000;
const POLL_EVENTS = 60_000;
const POLL_MEALS = 120_000;
const GC = 10 * 60_000; // cap retained (paged-away) week/month query pages
const HearthView = z.enum(['week', 'month']);

function HearthInner() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { weekDays, dayLabel, locale } = useFormatters();
  // View is remembered per browser; the paged-to week/month only for a short
  // while (lib/hearth-prefs.ts), so the wall drifts back to today.
  const [view, setView] = usePersistedState('hearth:view', HearthView, 'week');
  const [initialPosition] = useState(() => loadHearthPosition());
  const [weekOffset, setWeekOffset] = useState(initialPosition.weekOffset);
  const [monthOffset, setMonthOffset] = useState(initialPosition.monthOffset);
  const [openRecipeId, setOpenRecipeId] = useState<string | null>(null);
  const [addEventDate, setAddEventDate] = useState<string | null>(null);
  const [displayPrefs, setDisplayPrefs] = useState(() => loadHearthDisplayPrefs());
  const [displayOpen, setDisplayOpen] = useState(false);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const idle = useIdle();

  // Ticking clock (30s) — drives now/next and the header time without a busy
  // loop, and rolls the wall over at the household's midnight: today, the
  // highlighted day and the fetched week/month are all re-derived from it.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Save on paging only, not on mount: re-saving a restored position would
  // restart its expiry on every reload and keep the wall off today for good.
  // Compared by value rather than a "first run" flag, which StrictMode's
  // double-invoked effects would defeat.
  const savedPosition = useRef(initialPosition);
  useEffect(() => {
    const saved = savedPosition.current;
    if (saved.weekOffset === weekOffset && saved.monthOffset === monthOffset) return;
    savedPosition.current = { weekOffset, monthOffset };
    saveHearthPosition({ weekOffset, monthOffset });
  }, [weekOffset, monthOffset]);

  // Everything date-shaped on the wall is the HOUSEHOLD's, not the browser's:
  // a panel whose OS clock sits in another zone must still show the
  // household's today and fetch the household's week. Nothing date-shaped is
  // fetched or shown until the household's zone is known (a browser-zone week
  // would go out first and flash under the household's columns). If the
  // household cannot be loaded, the browser zone stands in so the wall still
  // works.
  const householdQuery = useHousehold();
  const zoneKnown = householdQuery.data !== undefined || householdQuery.isError;
  const timeZone = householdQuery.data?.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date(nowMs);
  const todayIso = todayInTimeZone(timeZone, now);

  // Visible range depends on the mode + paging offset. `base` and the range
  // ends are calendar dates (local-midnight carriers of household dates), so
  // the Monday-first week arithmetic is pure date arithmetic; only the API
  // windows below turn them into instants, at the household's midnight.
  const today = parseISO(todayIso);
  const base = view === 'week' ? addWeeks(today, weekOffset) : addMonths(today, monthOffset);
  const rangeFrom = view === 'week' ? startOfWeek(base, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(base), { weekStartsOn: 1 });
  const rangeTo = view === 'week' ? endOfWeek(base, { weekStartsOn: 1 }) : endOfWeek(endOfMonth(base), { weekStartsOn: 1 });
  const fromDay = format(rangeFrom, 'yyyy-MM-dd');
  const toDay = format(rangeTo, 'yyyy-MM-dd');
  // Inclusive instant window: household Mon 00:00 → the instant before the
  // following Monday's household midnight (the events/tasks/kith validators
  // take datetimes and compare inclusively).
  const fromIso = startOfDayInTimeZone(fromDay, timeZone).toISOString();
  const toIso = new Date(startOfDayInTimeZone(format(addDays(rangeTo, 1), 'yyyy-MM-dd'), timeZone).getTime() - 1).toISOString();

  const eventsQuery = useEvents({ from: fromIso, to: toIso }, { enabled: zoneKnown, refetchInterval: POLL_EVENTS, gcTime: GC, placeholderData: keepPreviousData });
  // Full instants, not fromDay/toDay: the tasks validator requires ISO
  // datetimes (date-only 400s, #3), and the household week boundaries match
  // the household-day bucketing used on the display side (lib/hearth.ts isoOf).
  const tasksQuery = useTasks({ due_from: fromIso, due_to: toIso }, { enabled: zoneKnown, refetchInterval: POLL_TASKS, gcTime: GC, placeholderData: keepPreviousData });
  const planQuery = useWeekPlan(fromDay, toDay, { enabled: zoneKnown, refetchInterval: POLL_MEALS, gcTime: GC, placeholderData: keepPreviousData });
  const membersQuery = useHouseholdMembers();
  const statusQuery = useIntegrationsFeedStatus();
  // KithLedger reminders: only when the integration is configured server-side
  // AND the wall toggle is on — otherwise the query never fires (no 404 loop).
  const featuresQuery = useFeatures();
  const kithEnabled = featuresQuery.data?.data.kithledger ?? false;
  const kithQuery = useKithReminders(
    { from: fromIso, to: toIso },
    { enabled: zoneKnown && kithEnabled && displayPrefs.kithReminders, refetchInterval: POLL_EVENTS, gcTime: GC, placeholderData: keepPreviousData },
  );
  const complete = useCompleteTask();
  const upsertMeal = useUpsertPlanEntry();
  const deleteMeal = useDeletePlanEntry();

  const occurrences = (eventsQuery.data?.data ?? []) as EventOccurrence[];
  const allTasks = tasksQuery.data?.data ?? [];
  const allEntries = planQuery.data?.data ?? [];
  // Display prefs: hidden elements see empty lists; the queries keep polling
  // so re-enabling is instant.
  const tasks = displayPrefs.tasks ? allTasks : [];
  const entries = displayPrefs.meals ? allEntries : [];
  const members = membersQuery.data?.data ?? [];
  const feeds = statusQuery.data ?? [];
  // Degrade silently: if KithLedger is unreachable (502 KITH_UNAVAILABLE) the
  // wall keeps rendering everything else and simply omits the reminders.
  const reminders: KithReminder[] = kithEnabled && displayPrefs.kithReminders
    ? ((kithQuery.data?.data ?? []) as KithReminder[])
    : [];

  const membersById = useMemo(() => Object.fromEntries(members.map((m: Member) => [m.id, m])), [members]);
  // Recipes come embedded in the plan entries, never from the paged recipe
  // list — a supper whose recipe sorts past its first page would vanish.
  const recipesById = useMemo(
    () => Object.fromEntries(allEntries.flatMap((e) => (e.recipe ? [[e.recipe.id, e.recipe] as const] : []))) as Record<string, Recipe>,
    [allEntries],
  );
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
      return composeDay(iso, occurrences, entries, tasks, todayIso, { completingIds, timeZone });
    });
  }, [view, base, occurrences, entries, tasks, todayIso, completingIds, timeZone]);

  const todayComposition = composeDay(todayIso, occurrences, entries, tasks, todayIso, { completingIds, timeZone });
  const dueTodayCount = tasksForDay(tasks, todayIso, todayIso, { completingIds, timeZone }).open.length;

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

  // Waiting for the household's zone: a bare wall, no browser-zone dates.
  if (!zoneKnown) return <div className="fixed inset-0 bg-parchment" aria-busy="true" />;

  // Wall display: fixed to the viewport so the burn-in drift (a transform) can
  // never widen or lengthen the document (no scrollbar, no 100vw overflow).
  // A wall display first: the unprefixed classes are the panel layout and stay
  // as they are. Below md (max-md:) the page scrolls like a phone page instead:
  // header and strip stack, and the week becomes one day per row.

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-parchment px-8 py-6 hearth-drift max-md:static max-md:inset-auto max-md:h-auto max-md:min-h-screen max-md:w-full max-md:overflow-y-visible max-md:px-4 max-md:py-4">
      {/* Header */}
      <header className="mb-5 flex items-end justify-between gap-6 max-md:flex-col max-md:items-stretch max-md:gap-3">
        <div>
          <h1 className="font-serif text-5xl leading-none text-ink max-md:text-4xl">{format(today, 'EEEE', { locale })}</h1>
          <p className="mt-1 text-xl text-ash max-md:text-base">{format(today, t('hearth.header.datePattern'), { locale })} · {formatClock(now, timeZone)}</p>
        </div>
        <div className="flex flex-col items-end gap-3 max-md:items-stretch">
          <div className="flex items-center gap-2 max-md:justify-between">
            {/* Wallboard display settings (which elements the wall shows). */}
            <button
              onClick={() => setDisplayOpen(true)}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-2 rounded-xl border border-tan bg-card px-5 py-3 text-lg text-ash max-md:px-3 max-md:py-2 max-md:text-base"
            >
              <SlidersHorizontal className="h-5 w-5" aria-hidden />
              {t('hearth.display.button')}
            </button>
            <div className="inline-flex rounded-xl border border-tan bg-card p-1">
              {(['week', 'month'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-lg px-5 py-2 text-lg max-md:px-3 max-md:py-1.5 max-md:text-base ${view === v ? 'bg-ember text-on-primary' : 'text-ash'}`}
                >
                  {t(v === 'week' ? 'hearth.view.week' : 'hearth.view.month')}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 max-md:gap-2">
            <button onClick={() => page(-1)} aria-label={t('hearth.nav.previous')} className="flex h-11 w-11 items-center justify-center rounded-full border border-tan bg-card text-ink">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <span className="min-w-56 text-center font-serif text-2xl text-ink max-md:min-w-0 max-md:flex-1 max-md:text-xl">{label}</span>
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
            showSupper={displayPrefs.meals}
            showTasks={displayPrefs.tasks}
            timeZone={timeZone}
          />
        </div>
      )}

      {/* Main surface */}
      {view === 'week' ? (
        <HearthWeek
          days={days}
          reminders={reminders}
          todayIso={todayIso}
          membersById={membersById}
          recipesById={recipesById}
          staleByOwner={staleByOwner}
          completingIds={completingIds}
          onCompleteTask={onCompleteTask}
          onOpenRecipe={setOpenRecipeId}
          onSwapMeal={onSwapMeal}
          onAddEvent={setAddEventDate}
          timeZone={timeZone}
        />
      ) : (
        <HearthMonth
          year={base.getFullYear()}
          month0={base.getMonth()}
          todayIso={todayIso}
          occurrences={occurrences}
          entries={entries}
          tasks={tasks}
          reminders={reminders}
          membersById={membersById}
          recipesById={recipesById}
          staleByOwner={staleByOwner}
          onAddEvent={setAddEventDate}
          timeZone={timeZone}
        />
      )}

      {/* Freshness / staleness footer */}
      <footer className="mt-4 flex items-center justify-between gap-6 text-sm text-ash/80 max-md:gap-3">
        <span className="shrink-0">
          {reconnecting ? t('hearth.footer.reconnecting') : ''}{t('hearth.footer.asOf', { time: formatClock(new Date(updatedAt), timeZone) })}
        </span>
        {displayPrefs.staleFooter && staleNotes.length > 0 && (
          <span className="truncate text-right">{staleNotes.join('   ·   ')}</span>
        )}
      </footer>

      {/* Recipe reading overlay */}
      {openRecipe && <RecipeOverlay recipe={openRecipe} onClose={() => setOpenRecipeId(null)} />}

      {/* Add-event overlay (tap a day) */}
      {addEventDate && <AddEventOverlay date={addEventDate} onClose={() => setAddEventDate(null)} />}

      {/* Display settings modal */}
      {displayOpen && (
        <DisplayPrefsModal
          prefs={displayPrefs}
          showKithRow={kithEnabled}
          onChange={(patch) => {
            setDisplayPrefs((prev) => {
              const next = { ...prev, ...patch };
              saveHearthDisplayPrefs(next);
              return next;
            });
          }}
          onClose={() => setDisplayOpen(false)}
        />
      )}

      {/* Idle dim (screen-burn friendly) — any touch clears it via useIdle */}
      {idle && !openRecipe && !addEventDate && !displayOpen && (
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
