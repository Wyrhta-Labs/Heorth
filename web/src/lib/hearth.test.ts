// Force a fixed non-UTC offset for this file BEFORE any other import touches
// Date/Intl, so the local-day-boundary assertions below are meaningful in a
// UTC CI runner and not just an accidental pass. Europe/Berlin matches the
// household's assumed locale (UTC+1/+2 with DST) called out in the finding.
process.env.TZ = 'Europe/Berlin';

import { describe, it, expect } from 'vitest';
import i18n from '@/i18n';
import {
  composeDay, computeMealSwap, deriveStaleness, effectiveDueAt, eventsForDay, formatAge,
  ownerOfFeed, pickNowNext, remindersForDay, resolveAttribution, tasksForDay,
  HOUSEHOLD_COLOR, type FeedStatus,
} from './hearth';
import { MEMBER_COLORS } from './constants';
import type { EventOccurrence, KithReminder, MealPlanEntry, Member, Task } from './types';

// ---- fixtures -------------------------------------------------------------
const member = (id: string, color: Member['avatarColor']): Member => ({
  id, createdAt: '', updatedAt: '', email: `${id}@h`, handle: null,
  role: 'adult', displayName: id.toUpperCase(), avatarColor: color,
});
const membersById: Record<string, Member> = {
  alex: member('alex', 'sky'),
  sam: member('sam', 'sage'),
};

function ev(partial: Partial<EventOccurrence> & { occurrenceStart: string }): EventOccurrence {
  return {
    id: partial.id ?? 'e1', createdAt: '', updatedAt: '', title: partial.title ?? 'Event',
    startAt: partial.startAt ?? partial.occurrenceStart, endAt: partial.endAt ?? partial.occurrenceStart,
    allDay: partial.allDay ?? false, location: null, notes: null, category: null, color: null,
    createdBy: partial.createdBy ?? '', recurrence: null,
    attendeeIds: partial.attendeeIds ?? [], occurrenceStart: partial.occurrenceStart,
    source: partial.source, organizer: partial.organizer ?? null, feedKey: partial.feedKey,
  };
}

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    id: partial.id, source: 'm365', feedKey: 'todo:member:alex:L1', externalId: partial.id,
    memberId: partial.memberId ?? 'alex', listId: 'L1', listName: 'Chores',
    title: partial.title ?? 'Task', notes: null, dueAt: partial.dueAt ?? null,
    completedAt: partial.completedAt ?? null, status: partial.status ?? 'open',
    createdAt: '', updatedAt: '', syncedAt: '',
  };
}

// ---- attribution / family colour policy -----------------------------------
describe('resolveAttribution', () => {
  it('renders family-feed events as the household shared band (not a member colour)', () => {
    const a = resolveAttribution(ev({ occurrenceStart: '2026-07-24T09:00:00Z', feedKey: 'calendar:family', source: 'm365' }), membersById);
    expect(a.kind).toBe('family');
    expect(a.color).toBe(HOUSEHOLD_COLOR);
    expect(Object.values(MEMBER_COLORS)).not.toContain(a.color);
  });

  it('uses the attendee member colour for a member event', () => {
    const a = resolveAttribution(ev({ occurrenceStart: '2026-07-24T09:00:00Z', attendeeIds: ['sam'] }), membersById);
    expect(a.kind).toBe('member');
    expect(a.memberId).toBe('sam');
    expect(a.color).toBe(MEMBER_COLORS.sage);
  });

  it('falls back to the creator when no attendee resolves', () => {
    const a = resolveAttribution(ev({ occurrenceStart: '2026-07-24T09:00:00Z', createdBy: 'alex' }), membersById);
    expect(a.memberId).toBe('alex');
    expect(a.color).toBe(MEMBER_COLORS.sky);
  });

  it('degrades to neutral for an unknown member id', () => {
    const a = resolveAttribution(ev({ occurrenceStart: '2026-07-24T09:00:00Z', attendeeIds: ['ghost'] }), membersById);
    expect(a.kind).toBe('none');
  });
});

// ---- day composition ------------------------------------------------------
describe('day composition', () => {
  const occ = [
    ev({ id: 'a', occurrenceStart: '2026-07-24T18:00:00Z', title: 'Piano' }),
    ev({ id: 'b', occurrenceStart: '2026-07-24T08:00:00Z', title: 'Dentist' }),
    ev({ id: 'c', occurrenceStart: '2026-07-24T00:00:00Z', title: 'Bin day', allDay: true }),
    ev({ id: 'd', occurrenceStart: '2026-07-25T10:00:00Z', title: 'Other day' }),
  ];

  it('groups a day\'s events, all-day first then chronological', () => {
    const list = eventsForDay(occ, '2026-07-24');
    expect(list.map((o) => o.id)).toEqual(['c', 'b', 'a']);
  });

  it('merges events, supper, and due tasks for one day', () => {
    const entries: MealPlanEntry[] = [
      { id: 'm1', createdAt: '', updatedAt: '', date: '2026-07-24', slot: 'supper', recipeId: 'r1', freeText: null, cook: null, helper: null },
      { id: 'm2', createdAt: '', updatedAt: '', date: '2026-07-24', slot: 'lunch', recipeId: 'r9', freeText: null, cook: null, helper: null },
    ];
    const tasks = [task({ id: 't1', dueAt: '2026-07-24T00:00:00Z' })];
    const comp = composeDay('2026-07-24', occ, entries, tasks, '2026-07-24');
    expect(comp.events).toHaveLength(3);
    expect(comp.supper?.id).toBe('m1'); // supper only, not lunch
    expect(comp.tasks.open).toHaveLength(1);
  });
});

// ---- KithLedger reminders ---------------------------------------------------
function reminder(partial: Partial<KithReminder> & { id: string; dueAt: string }): KithReminder {
  return {
    id: partial.id, createdAt: '', updatedAt: '', personId: partial.personId ?? 'p1',
    dueAt: partial.dueAt, title: partial.title ?? 'Reminder', notes: null,
    status: partial.status ?? 'pending', snoozedUntil: partial.snoozedUntil ?? null,
    recurrence: null, kind: partial.kind ?? 'generic', leadDays: partial.leadDays ?? 0,
  };
}

describe('remindersForDay', () => {
  it('uses the effective due: snoozedUntil when snoozed, else dueAt', () => {
    expect(effectiveDueAt(reminder({ id: 'a', dueAt: '2026-07-24T09:00:00Z' }))).toBe('2026-07-24T09:00:00Z');
    expect(effectiveDueAt(reminder({ id: 'b', dueAt: '2026-07-20T09:00:00Z', status: 'snoozed', snoozedUntil: '2026-07-24T09:00:00Z' }))).toBe('2026-07-24T09:00:00Z');
    // Snoozed without a snoozedUntil degrades to dueAt rather than crashing.
    expect(effectiveDueAt(reminder({ id: 'c', dueAt: '2026-07-20T09:00:00Z', status: 'snoozed' }))).toBe('2026-07-20T09:00:00Z');
  });

  it('buckets by effective due into local days, soonest first', () => {
    const rs = [
      reminder({ id: 'late', dueAt: '2026-07-24T15:00:00Z' }),
      reminder({ id: 'early', dueAt: '2026-07-24T07:00:00Z' }),
      reminder({ id: 'moved', dueAt: '2026-07-20T09:00:00Z', status: 'snoozed', snoozedUntil: '2026-07-24T10:00:00Z' }),
      reminder({ id: 'other', dueAt: '2026-07-25T09:00:00Z' }),
    ];
    expect(remindersForDay(rs, '2026-07-24').map((r) => r.id)).toEqual(['early', 'moved', 'late']);
    expect(remindersForDay(rs, '2026-07-25').map((r) => r.id)).toEqual(['other']);
  });

  it('buckets by the LOCAL day, not the UTC date (Europe/Berlin)', () => {
    // 22:30Z on the 24th is 00:30 local on the 25th in July (UTC+2).
    const rs = [reminder({ id: 'x', dueAt: '2026-07-24T22:30:00Z' })];
    expect(remindersForDay(rs, '2026-07-24')).toHaveLength(0);
    expect(remindersForDay(rs, '2026-07-25').map((r) => r.id)).toEqual(['x']);
  });
});

// ---- completed-task cap / collapse / reset --------------------------------
describe('tasksForDay completed cap + midnight reset', () => {
  const iso = '2026-07-24';
  const mk = (id: string, completedAt: string | null) => task({ id, dueAt: `${iso}T00:00:00Z`, status: 'completed', completedAt });

  it('shows completions from today, most-recent first, capped, with a hidden count', () => {
    const tasks = [
      mk('c1', '2026-07-24T09:00:00Z'),
      mk('c2', '2026-07-24T11:00:00Z'),
      mk('c3', '2026-07-24T08:00:00Z'),
      mk('c4', '2026-07-24T12:00:00Z'),
    ];
    const r = tasksForDay(tasks, iso, iso, new Set(), 3);
    expect(r.completed.map((t) => t.id)).toEqual(['c4', 'c2', 'c1']); // recent-first, capped 3
    expect(r.hiddenCompleted).toBe(1);
  });

  it('drops completions from a previous day (reset at the boundary)', () => {
    // Comfortably mid-day on the 23rd in every TZ this suite might run under,
    // so it's unambiguously "yesterday" relative to the LOCAL iso ('2026-07-24')
    // regardless of the runtime's UTC offset.
    const tasks = [mk('old', '2026-07-23T10:00:00Z')];
    const r = tasksForDay(tasks, iso, iso);
    expect(r.completed).toHaveLength(0);
  });

  it('treats an optimistic completing id as struck-through immediately', () => {
    const tasks = [task({ id: 'o1', dueAt: `${iso}T00:00:00Z`, status: 'open' })];
    const r = tasksForDay(tasks, iso, iso, new Set(['o1']));
    expect(r.open).toHaveLength(0);
    expect(r.completed.map((t) => t.id)).toEqual(['o1']);
  });
});

// ---- local-day bucketing / midnight reset (not UTC) -----------------------
// Europe/Berlin is DST-aware (UTC+2 in July), so these use an explicit +02:00
// offset in the fixtures to stay unambiguous regardless of the exact TZ the
// runner resolves DST rules with, while still exercising the local (not UTC)
// bucketing path end to end (process.env.TZ is set at the top of this file).
describe('local-day boundary (not UTC) for events and task completion', () => {
  it('buckets a late-evening timed event into the LOCAL day, not the UTC day', () => {
    // 23:30 UTC on the 23rd == 01:30 local (+02:00) on the 24th.
    const occ = [ev({ id: 'late', occurrenceStart: '2026-07-23T23:30:00+00:00', title: 'Late one' })];
    expect(eventsForDay(occ, '2026-07-24').map((o) => o.id)).toEqual(['late']);
    expect(eventsForDay(occ, '2026-07-23')).toHaveLength(0);
  });

  it('treats a task completed after local midnight as completed on the LOCAL next day', () => {
    // 22:50 UTC on the 23rd == 00:50 local (+02:00) on the 24th: completed-today
    // must be judged against the LOCAL "today", not the UTC calendar date.
    const t = task({ id: 'late-done', dueAt: '2026-07-24T00:00:00+00:00', status: 'completed', completedAt: '2026-07-23T22:50:00+00:00' });
    const todayLocalIso = '2026-07-24'; // the LOCAL day the completion actually falls on
    const r = tasksForDay([t], todayLocalIso, todayLocalIso);
    expect(r.completed.map((x) => x.id)).toEqual(['late-done']);
  });

  it('does NOT show that same completion as "today" against the UTC day (regression guard)', () => {
    const t = task({ id: 'late-done-2', dueAt: '2026-07-23T00:00:00+00:00', status: 'completed', completedAt: '2026-07-23T22:50:00+00:00' });
    // The UTC calendar date of the completion instant is still the 23rd — if
    // bucketing regressed to UTC slicing, this would be the day it shows under.
    const r = tasksForDay([t], '2026-07-23', '2026-07-23');
    expect(r.completed).toHaveLength(0);
  });
});

// ---- now / next -----------------------------------------------------------
describe('pickNowNext', () => {
  const occ = [
    ev({ id: 'past', occurrenceStart: '2026-07-24T08:00:00Z', endAt: '2026-07-24T09:00:00Z', startAt: '2026-07-24T08:00:00Z' }),
    ev({ id: 'live', occurrenceStart: '2026-07-24T09:30:00Z', startAt: '2026-07-24T09:30:00Z', endAt: '2026-07-24T11:00:00Z' }),
    ev({ id: 'soon', occurrenceStart: '2026-07-24T14:00:00Z', startAt: '2026-07-24T14:00:00Z', endAt: '2026-07-24T15:00:00Z' }),
    ev({ id: 'allday', occurrenceStart: '2026-07-24T00:00:00Z', allDay: true }),
  ];
  const now = new Date('2026-07-24T10:00:00Z').getTime();

  it('finds the ongoing event as current and the following as next', () => {
    const { current, next } = pickNowNext(occ, now);
    expect(current?.id).toBe('live');
    expect(next?.id).toBe('soon');
  });

  it('returns only next when nothing is ongoing', () => {
    const { current, next } = pickNowNext(occ, new Date('2026-07-24T12:00:00Z').getTime());
    expect(current).toBeNull();
    expect(next?.id).toBe('soon');
  });
});

// ---- meal swap / move persistence -----------------------------------------
describe('computeMealSwap', () => {
  const entries: MealPlanEntry[] = [
    { id: 'mon', createdAt: '', updatedAt: '', date: '2026-07-20', slot: 'supper', recipeId: 'r-pie', freeText: null, cook: 'alex', helper: null },
    { id: 'tue', createdAt: '', updatedAt: '', date: '2026-07-21', slot: 'supper', recipeId: null, freeText: 'Leftovers', cook: null, helper: null },
  ];

  it('swaps two populated days (each gets the other\'s content)', () => {
    const ops = computeMealSwap(entries, '2026-07-20', '2026-07-21');
    expect(ops).toEqual([
      { type: 'upsert', input: { date: '2026-07-21', slot: 'supper', recipeId: 'r-pie', freeText: null, cook: 'alex', helper: null } },
      { type: 'upsert', input: { date: '2026-07-20', slot: 'supper', recipeId: null, freeText: 'Leftovers', cook: null, helper: null } },
    ]);
  });

  it('moves onto an empty day (target upserted, source deleted)', () => {
    const ops = computeMealSwap(entries, '2026-07-20', '2026-07-22');
    expect(ops).toEqual([
      { type: 'upsert', input: { date: '2026-07-22', slot: 'supper', recipeId: 'r-pie', freeText: null, cook: 'alex', helper: null } },
      { type: 'delete', id: 'mon' },
    ]);
  });

  it('is a no-op for same-day or two empty days', () => {
    expect(computeMealSwap(entries, '2026-07-20', '2026-07-20')).toEqual([]);
    expect(computeMealSwap(entries, '2026-07-28', '2026-07-29')).toEqual([]);
  });
});

// ---- staleness derivation -------------------------------------------------
describe('staleness from /status feeds[]', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');
  const feed = (partial: Partial<FeedStatus> & { feedKey: string }): FeedStatus => ({
    feedKey: partial.feedKey, lastSuccessAt: partial.lastSuccessAt ?? '2026-07-24T11:59:00Z',
    lastError: partial.lastError ?? null, consecutiveFailures: partial.consecutiveFailures ?? 0,
    updatedAt: '2026-07-24T12:00:00Z',
  });

  it('maps feed keys to their owner', () => {
    expect(ownerOfFeed('calendar:family')).toBe('family');
    expect(ownerOfFeed('calendar:member:alex')).toBe('alex');
    expect(ownerOfFeed('todo:member:sam:AAA')).toBe('sam');
    expect(ownerOfFeed('nonsense')).toBeNull();
  });

  it('flags a member stale when a feed errors, and surfaces needs_reauth', () => {
    const s = deriveStaleness([feed({ feedKey: 'calendar:member:alex', lastError: 'needs_reauth' })], now);
    expect(s.alex.stale).toBe(true);
    expect(s.alex.needsReauth).toBe(true);
  });

  it('flags stale on an old last success even with no error', () => {
    const s = deriveStaleness([feed({ feedKey: 'calendar:member:sam', lastSuccessAt: '2026-07-24T10:00:00Z' })], now);
    expect(s.sam.stale).toBe(true); // > 30m old
  });

  it('keeps a fresh feed not stale and aggregates the oldest success per owner', () => {
    const s = deriveStaleness([
      feed({ feedKey: 'calendar:member:alex', lastSuccessAt: '2026-07-24T11:55:00Z' }),
      feed({ feedKey: 'todo:member:alex:L1', lastSuccessAt: '2026-07-24T11:40:00Z' }),
    ], now);
    expect(s.alex.stale).toBe(false);
    expect(s.alex.lastSuccessAt).toBe('2026-07-24T11:40:00Z'); // oldest of the two
  });
});

describe('formatAge', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');
  it('formats compact ages', () => {
    expect(formatAge('2026-07-24T11:57:00Z', now, i18n.t)).toBe('3m');
    expect(formatAge('2026-07-24T10:00:00Z', now, i18n.t)).toBe('2h');
    expect(formatAge('2026-07-21T12:00:00Z', now, i18n.t)).toBe('3d');
    expect(formatAge(null, now, i18n.t)).toBe('never');
  });
});
