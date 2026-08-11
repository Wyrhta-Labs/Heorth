// Pure composition + derivation logic for the Hearth View (the /hearth kitchen
// wall). Kept framework-free and side-effect-free so it can be unit-tested
// directly — the React components in components/hearth/ are thin renderers over
// these functions.

import { format } from 'date-fns';
import type { TFunction } from 'i18next';
import { MEMBER_COLORS } from './constants';
import { isMirroredEvent, type EventOccurrence, type KithReminder, type MealPlanEntry, type Member, type Task } from './types';

// ---------------------------------------------------------------------------
// Family / household colour policy (delegated to Task 2.5 by the brief).
//
// Mirrored family-calendar events carry no member attribution (feedKey
// `calendar:family`, no member_id). Rather than borrow a member's colour or
// leave them uncoloured, they render as the household's own SHARED colour band —
// warm amber (#a07535), which is deliberately NOT one of the four member avatar
// colours (ember / taupe / sage / sky). The band reads as "this belongs to the
// whole house", distinct from any one person.
// ---------------------------------------------------------------------------
export const HOUSEHOLD_COLOR = '#a07535';
export const HOUSEHOLD_LABEL = 'Family';

/** Default caps / thresholds (overridable by callers/tests). */
export const COMPLETED_CAP = 3;
export const STALE_AFTER_MS = 30 * 60 * 1000; // a feed silent > 30m reads as stale

export type AttributionKind = 'family' | 'member' | 'none';
export interface Attribution {
  kind: AttributionKind;
  memberId: string | null; // null for family / unattributed
  color: string;
  label: string;
}

/** Whether an occurrence is the shared family feed (household-wide, no member). */
export function isFamilyEvent(o: EventOccurrence): boolean {
  if (o.feedKey === 'calendar:family') return true;
  // Defensive: a mirrored event with no resolvable member attribution is
  // household-shared too.
  return isMirroredEvent(o) && (o.attendeeIds ?? []).filter(Boolean).length === 0 && !o.createdBy;
}

/**
 * Who an event belongs to, for the colour dot / band on the wall. Family events
 * → the shared household band; otherwise the first attendee that resolves to a
 * member, falling back to the creator. Members are looked up by id so a stale
 * attendee id (e.g. a removed member) degrades to a neutral chip rather than
 * throwing.
 */
export function resolveAttribution(
  o: EventOccurrence,
  membersById: Record<string, Member>,
): Attribution {
  if (isFamilyEvent(o)) {
    return { kind: 'family', memberId: null, color: HOUSEHOLD_COLOR, label: HOUSEHOLD_LABEL };
  }
  const candidateIds = [...(o.attendeeIds ?? []).filter(Boolean), o.createdBy];
  for (const id of candidateIds) {
    const m = id ? membersById[id] : undefined;
    if (m) return { kind: 'member', memberId: m.id, color: MEMBER_COLORS[m.avatarColor], label: m.displayName };
  }
  return { kind: 'none', memberId: null, color: '#b5542f', label: '' };
}

// ---------------------------------------------------------------------------
// Day composition — merge events + supper + due/done tasks for one calendar day
// ---------------------------------------------------------------------------
export interface DayTasks {
  open: Task[];
  /** Completed today, most-recent first, capped at `cap`. */
  completed: Task[];
  /** How many completed-today tasks are hidden behind the "+N done" collapse. */
  hiddenCompleted: number;
}

export interface DayComposition {
  iso: string;
  events: EventOccurrence[];
  supper: MealPlanEntry | null;
  tasks: DayTasks;
}

/**
 * Local-day bucket key for an ISO instant. Household timezone === server/
 * browser local (this is a self-hosted, single-household deployment — there is
 * no cross-timezone household to reconcile), so the LOCAL calendar day is the
 * correct reset/bucketing boundary. A naive `dateStr.slice(0, 10)` reads the
 * UTC date instead: in UTC+1/+2 that shifts the midnight reset to 01:00–02:00
 * local and mis-buckets late-evening timed events into the wrong day column.
 * `todayIso` and the column keys are already local-formatted (see
 * `dayLabel`/`format` in pages/hearth.tsx), so every comparison against them
 * must go through this same local formatting.
 */
function isoOf(dateStr: string): string {
  return format(new Date(dateStr), 'yyyy-MM-dd');
}

/** Events whose occurrence falls on `iso`, all-day first then chronological. */
export function eventsForDay(occurrences: EventOccurrence[], iso: string): EventOccurrence[] {
  return occurrences
    .filter((o) => isoOf(o.occurrenceStart) === iso)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.occurrenceStart.localeCompare(b.occurrenceStart);
    });
}

/**
 * Tasks for a day column, keyed by DUE date:
 * - `open`: open tasks due that day (tappable to complete).
 * - `completed`: tasks due that day AND completed TODAY (struck through until
 *   midnight, then they drop off), most-recent completion first, capped.
 * `completingIds` marks tasks the user just tapped so they strike through
 * immediately (before the write-through poll reconciles).
 */
export function tasksForDay(
  tasks: Task[],
  iso: string,
  todayIso: string,
  completingIds: ReadonlySet<string> = new Set(),
  cap = COMPLETED_CAP,
): DayTasks {
  const due = tasks.filter((t) => t.dueAt && isoOf(t.dueAt) === iso);
  const open: Task[] = [];
  const completedAll: Task[] = [];
  for (const t of due) {
    const done = t.status === 'completed' || completingIds.has(t.id);
    if (!done) {
      open.push(t);
      continue;
    }
    // Only show completions from today (reset at the day boundary). An optimistic
    // completion (still `open` in cache but tapped) counts as completed-today.
    const completedToday = completingIds.has(t.id)
      ? true
      : t.completedAt !== null && isoOf(t.completedAt) === todayIso;
    if (completedToday) completedAll.push(t);
  }
  open.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  completedAll.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  return {
    open,
    completed: completedAll.slice(0, cap),
    hiddenCompleted: Math.max(0, completedAll.length - cap),
  };
}

export function composeDay(
  iso: string,
  occurrences: EventOccurrence[],
  entries: MealPlanEntry[],
  tasks: Task[],
  todayIso: string,
  completingIds: ReadonlySet<string> = new Set(),
  cap = COMPLETED_CAP,
): DayComposition {
  return {
    iso,
    events: eventsForDay(occurrences, iso),
    supper: entries.find((e) => e.date === iso && e.slot === 'supper') ?? null,
    tasks: tasksForDay(tasks, iso, todayIso, completingIds, cap),
  };
}

// ---------------------------------------------------------------------------
// KithLedger reminders — read-only extras on the wall
// ---------------------------------------------------------------------------

/**
 * The instant a reminder is actually due: a snoozed reminder moved to its
 * `snoozedUntil`, everything else sits on `dueAt`. Mirrors the server's
 * windowing convention (src/modules/kith) so day bucketing agrees with what
 * the range query returned.
 */
export function effectiveDueAt(r: KithReminder): string {
  return r.status === 'snoozed' && r.snoozedUntil ? r.snoozedUntil : r.dueAt;
}

/** Reminders effectively due on local day `iso`, soonest first. Same local-day bucketing as events/tasks (`isoOf`). */
export function remindersForDay(reminders: KithReminder[], iso: string): KithReminder[] {
  return reminders
    .filter((r) => isoOf(effectiveDueAt(r)) === iso)
    .sort((a, b) => effectiveDueAt(a).localeCompare(effectiveDueAt(b)));
}

// ---------------------------------------------------------------------------
// Now / Next selection for today's strip
// ---------------------------------------------------------------------------
export function occurrenceEndMs(o: EventOccurrence): number {
  const start = new Date(o.startAt).getTime();
  const end = new Date(o.endAt).getTime();
  const dur = Number.isFinite(end - start) ? Math.max(0, end - start) : 0;
  return new Date(o.occurrenceStart).getTime() + dur;
}

export interface NowNext {
  current: EventOccurrence | null;
  next: EventOccurrence | null;
}

/** The event happening now (if any) and the next timed event still to come. */
export function pickNowNext(occurrences: EventOccurrence[], nowMs: number): NowNext {
  const timed = occurrences
    .filter((o) => !o.allDay)
    .sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
  let current: EventOccurrence | null = null;
  let next: EventOccurrence | null = null;
  for (const o of timed) {
    const s = new Date(o.occurrenceStart).getTime();
    const e = occurrenceEndMs(o);
    if (s <= nowMs && nowMs < e) {
      if (!current) current = o;
    } else if (s > nowMs && !next) {
      next = o;
    }
  }
  return { current, next };
}

// ---------------------------------------------------------------------------
// Meal drag / swap — the single edit gesture on the wall
// ---------------------------------------------------------------------------
export interface MealUpsertOp {
  type: 'upsert';
  input: { date: string; slot: 'supper'; recipeId: string | null; freeText: string | null; cook: string | null; helper: string | null };
}
export interface MealDeleteOp { type: 'delete'; id: string }
export type MealOp = MealUpsertOp | MealDeleteOp;

function contentOf(e: MealPlanEntry | undefined, date: string): MealUpsertOp {
  return {
    type: 'upsert',
    input: {
      date,
      slot: 'supper',
      recipeId: e?.recipeId ?? null,
      freeText: e?.freeText ?? null,
      cook: e?.cook ?? null,
      helper: e?.helper ?? null,
    },
  };
}

/**
 * The persistence operations to SWAP the supper between two days. If the target
 * day is empty the swap degrades to a move (source cleared via delete). Returns
 * the minimal op list; the caller replays them against the meal-plan API
 * (upsert = POST /meals/plan which is keyed by date+slot; delete for clears).
 */
export function computeMealSwap(
  entries: MealPlanEntry[],
  fromDate: string,
  toDate: string,
  slot: 'supper' = 'supper',
): MealOp[] {
  if (fromDate === toDate) return [];
  const from = entries.find((e) => e.date === fromDate && e.slot === slot);
  const to = entries.find((e) => e.date === toDate && e.slot === slot);
  if (!from && !to) return [];
  const ops: MealOp[] = [];

  // Target day receives the source's content (or is cleared if source empty).
  if (from) ops.push(contentOf(from, toDate));
  else if (to) ops.push({ type: 'delete', id: to.id });

  // Source day receives the target's content (or is cleared if target empty).
  if (to) ops.push(contentOf(to, fromDate));
  else if (from) ops.push({ type: 'delete', id: from.id });

  return ops;
}

// ---------------------------------------------------------------------------
// Per-feed staleness derivation from GET /api/v1/m365/status feeds[]
// ---------------------------------------------------------------------------
export interface FeedStatus {
  feedKey: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  updatedAt: string;
}

export interface StalenessInfo {
  stale: boolean;
  needsReauth: boolean;
  lastSuccessAt: string | null;
}

/** Map a feed key to the member it belongs to, or 'family', or null. */
export function ownerOfFeed(feedKey: string): string | 'family' | null {
  if (feedKey === 'calendar:family') return 'family';
  const cal = feedKey.match(/^calendar:member:(.+)$/);
  if (cal) return cal[1]!;
  const todo = feedKey.match(/^todo:member:([^:]+):/);
  if (todo) return todo[1]!;
  return null;
}

function feedIsStale(f: FeedStatus, nowMs: number, staleAfterMs: number): boolean {
  if (f.lastError) return true;
  if (f.consecutiveFailures > 0) return true;
  if (!f.lastSuccessAt) return true;
  return nowMs - new Date(f.lastSuccessAt).getTime() > staleAfterMs;
}

/**
 * Aggregate per-owner staleness. A member (or 'family') is stale if ANY of their
 * feeds is stale; needsReauth if any feed's classified error is `needs_reauth`
 * (the "reconnect from your phone" case); lastSuccessAt is the OLDEST success
 * across their feeds (the honest "as of" for the greyed items).
 */
export function deriveStaleness(
  feeds: FeedStatus[],
  nowMs: number,
  staleAfterMs = STALE_AFTER_MS,
): Record<string, StalenessInfo> {
  const out: Record<string, StalenessInfo> = {};
  for (const f of feeds) {
    const owner = ownerOfFeed(f.feedKey);
    if (!owner) continue;
    const stale = feedIsStale(f, nowMs, staleAfterMs);
    const needsReauth = f.lastError === 'needs_reauth';
    const prev = out[owner];
    const oldest = (() => {
      if (!prev?.lastSuccessAt) return f.lastSuccessAt;
      if (!f.lastSuccessAt) return prev.lastSuccessAt;
      return f.lastSuccessAt < prev.lastSuccessAt ? f.lastSuccessAt : prev.lastSuccessAt;
    })();
    out[owner] = {
      stale: (prev?.stale ?? false) || stale,
      needsReauth: (prev?.needsReauth ?? false) || needsReauth,
      lastSuccessAt: oldest,
    };
  }
  return out;
}

/** Compact "5m" / "2h" / "3d" age from a past ISO instant (for "last synced …"). */
export function formatAge(fromIso: string | null, nowMs: number, t: TFunction): string {
  if (!fromIso) return t('sync.age.never');
  const ms = nowMs - new Date(fromIso).getTime();
  if (ms < 0) return t('sync.age.justNow');
  const min = Math.floor(ms / 60000);
  if (min < 1) return t('sync.age.justNow');
  if (min < 60) return t('sync.age.minutes', { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('sync.age.hours', { count: hr });
  return t('sync.age.days', { count: Math.floor(hr / 24) });
}
