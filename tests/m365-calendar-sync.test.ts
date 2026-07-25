import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { m365SyncState } from '../src/m365/schema.js';
import { calendarMirrorEvents } from '../src/modules/calendar/mirror-schema.js';
import * as calendar from '../src/modules/calendar/service.js';
import { calendarRouter } from '../src/modules/calendar/routes.js';
import { calendarTools } from '../src/modules/calendar/mcp.js';
import { runCalendarSync } from '../src/m365/calendar-sync.js';
import { m365Router } from '../src/m365/routes.js';
import { feedKeys } from '../src/m365/feed-keys.js';
import { setM365Runtime } from '../src/m365/runtime.js';
import type { M365Runtime } from '../src/m365/runtime.js';
import { createFakeGraph, runtimeForFakeGraph, fakeM365Config, type FakeGraph, type FakeCalEvent } from './fake-graph.js';
import { seedTestHousehold, authHeaders, invokeTool } from './helpers.js';

afterEach(() => setM365Runtime(null));

/** Seed a household and a connected M365 connection for the adult member. */
async function seedConnectedMember(rt: M365Runtime) {
  const seeded = await seedTestHousehold();
  await rt.store.upsertConnection({
    memberId: seeded.adult.user.id,
    accountUpn: 'adult@contoso.test',
    refreshToken: 'refresh-initial',
    scopes: 'Calendars.Read offline_access',
  });
  return seeded;
}

function ev(id: string, subject: string, startUtc: string, endUtc: string, extra: Record<string, unknown> = {}) {
  return { id, subject, startUtc, endUtc, ...extra };
}

const WINDOW = { from: '2026-07-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' };

async function mirrorRows(feedKey: string) {
  return db.select().from(calendarMirrorEvents).where(eq(calendarMirrorEvents.feedKey, feedKey));
}

describe('m365 calendar mirror — sync', () => {
  it('initial full sync mirrors a member feed (across nextLink paging)', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    // Two pages to exercise @odata.nextLink within one pull.
    fake.setCalendar('me', [{
      pages: [
        { upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z', { location: 'Clinic', organizer: 'Reception' })] },
        { upserts: [ev('e2', 'Soccer', '2026-08-02T14:00:00.000Z', '2026-08-02T15:00:00.000Z')] },
      ],
    }]);

    const results = await runCalendarSync(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);
    const memberResult = results.find((r) => r.feedKey === feedKey)!;
    expect(memberResult.status).toBe('ok');
    expect(memberResult.upserted).toBe(2);

    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId).sort()).toEqual(['e1', 'e2']);
    const e1 = rows.find((r) => r.externalId === 'e1')!;
    expect(e1.title).toBe('Dentist');
    expect(e1.location).toBe('Clinic');
    expect(e1.organizer).toBe('Reception');
    expect(e1.memberId).toBe(adult.user.id);
    expect(e1.source).toBe('m365');

    // A delta token is persisted for the next incremental run.
    const state = await rt.store.getSyncState(feedKey);
    expect(state?.deltaToken).toBeTruthy();
    expect(state?.lastSuccessAt).toBeTruthy();
    expect(state?.consecutiveFailures).toBe(0);
  });

  it('applies an incremental delta (add + update)', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] }]);
    await runCalendarSync(rt);

    // Next token now points at batch 1: an update to e1 and a new e3.
    fake.setCalendar('me', [
      { pages: [{ upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] },
      { pages: [{ upserts: [
        ev('e1', 'Dentist (moved)', '2026-08-01T11:00:00.000Z', '2026-08-01T12:00:00.000Z'),
        ev('e3', 'Piano', '2026-08-03T16:00:00.000Z', '2026-08-03T17:00:00.000Z'),
      ] }] },
    ]);
    await runCalendarSync(rt);

    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId).sort()).toEqual(['e1', 'e3']);
    expect(rows.find((r) => r.externalId === 'e1')!.title).toBe('Dentist (moved)');
  });

  it('handles a @removed deletion in a delta', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [
      ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z'),
      ev('e2', 'Soccer', '2026-08-02T14:00:00.000Z', '2026-08-02T15:00:00.000Z'),
    ] }] }]);
    await runCalendarSync(rt);

    fake.setCalendar('me', [
      { pages: [{ upserts: [] }] },
      { pages: [{ removed: ['e2'] }] },
    ]);
    await runCalendarSync(rt);

    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId)).toEqual(['e1']);
  });

  it('does a full re-sync (replace) when the delta token is 410 Gone', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [
      ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z'),
      ev('e2', 'Soccer', '2026-08-02T14:00:00.000Z', '2026-08-02T15:00:00.000Z'),
    ] }] }]);
    await runCalendarSync(rt);
    expect((await mirrorRows(feedKey)).length).toBe(2);

    // The stored token now points at batch 1 (410); batch 0 is a fresh, smaller
    // snapshot. The re-sync must REPLACE the feed (e2 disappears).
    fake.setCalendar('me', [
      { pages: [{ upserts: [ev('e1', 'Dentist (rescheduled)', '2026-08-05T09:00:00.000Z', '2026-08-05T10:00:00.000Z')] }] },
      { pages: [], gone: true },
    ]);
    const results = await runCalendarSync(rt);
    expect(results.find((r) => r.feedKey === feedKey)!.status).toBe('ok');

    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId)).toEqual(['e1']);
    expect(rows[0]!.title).toBe('Dentist (rescheduled)');
  });

  it('mirrors the family feed via app-only auth', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    await seedTestHousehold(); // no member connection needed for the family feed
    fake.setCalendar(fakeM365Config.familyMailbox, [{ pages: [{ upserts: [
      ev('fam1', 'Bin day', '2026-08-04T07:00:00.000Z', '2026-08-04T07:30:00.000Z'),
    ] }] }]);

    const results = await runCalendarSync(rt);
    const familyResult = results.find((r) => r.feedKey === feedKeys.calendarFamily())!;
    expect(familyResult.status).toBe('ok');
    expect(fake.appTokenCount).toBeGreaterThan(0); // client_credentials was used

    const rows = await mirrorRows(feedKeys.calendarFamily());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.memberId).toBeNull(); // shared feed — no member attribution
  });

  it('isolates a per-feed error — a failing feed does not stop the others', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const memberKey = feedKeys.calendarMember(adult.user.id);

    fake.failDelta.add('me'); // member feed errors (500)
    fake.setCalendar(fakeM365Config.familyMailbox, [{ pages: [{ upserts: [
      ev('fam1', 'Bin day', '2026-08-04T07:00:00.000Z', '2026-08-04T07:30:00.000Z'),
    ] }] }]);

    const results = await runCalendarSync(rt);
    const member = results.find((r) => r.feedKey === memberKey)!;
    const family = results.find((r) => r.feedKey === feedKeys.calendarFamily())!;
    expect(member.status).toBe('error');
    expect(member.reason).toBe('graph_500');
    expect(family.status).toBe('ok'); // the loop continued past the failure

    // Failure is recorded (short classified string), success is recorded too.
    const memberState = await rt.store.getSyncState(memberKey);
    expect(memberState?.lastError).toBe('graph_500');
    expect(memberState?.consecutiveFailures).toBe(1);
    expect((await mirrorRows(feedKeys.calendarFamily()))).toHaveLength(1);
  });

  it('records needs_reauth without hot-retrying the token', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const memberKey = feedKeys.calendarMember(adult.user.id);
    // Mark the connection as needing re-consent.
    await rt.store.recordRefreshError(adult.user.id, 'refresh token expired', 'needs_reauth');

    const before = fake.refreshCount;
    const results = await runCalendarSync(rt);
    const member = results.find((r) => r.feedKey === memberKey)!;
    expect(member.status).toBe('skipped');
    expect(member.reason).toBe('needs_reauth');
    expect(fake.refreshCount).toBe(before); // no token refresh attempted

    const state = await rt.store.getSyncState(memberKey);
    expect(state?.lastError).toBe('needs_reauth');
  });

  it('persists and reuses the delta token across runs', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [ev('e1', 'A', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] }]);
    await runCalendarSync(rt);
    const tokenAfter1 = (await rt.store.getSyncState(feedKey))!.deltaToken;

    // Second run with no new batch → the stored token is sent back to Graph.
    await runCalendarSync(rt);
    const deltaCalls = fake.calls.filter((c) => c.path.endsWith('/me/calendarView/delta'));
    expect(deltaCalls.length).toBeGreaterThanOrEqual(2);
    const tokenAfter2 = (await rt.store.getSyncState(feedKey))!.deltaToken;
    expect(tokenAfter2).toBeTruthy();
    expect(tokenAfter1).toBeTruthy();
  });

  // --- deterministic periodic re-window (the rolling window actually rolls) --

  function deltaCallsFor(fake: FakeGraph) {
    return fake.calls.filter((c) => c.path.endsWith('/me/calendarView/delta'));
  }

  it('re-windows a feed whose last full sync is older than the threshold, even with a valid token', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [
      ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z'),
      ev('e2', 'Soccer', '2026-08-02T14:00:00.000Z', '2026-08-02T15:00:00.000Z'),
    ] }] }]);
    await runCalendarSync(rt);
    expect((await mirrorRows(feedKey)).length).toBe(2);
    const initialCall = deltaCallsFor(fake)[0]!;
    expect(initialCall.query).toContain('startDateTime=');

    // Age the feed's last full sync past the (default 7-day) threshold.
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.update(m365SyncState).set({ lastFullSyncAt: stale }).where(eq(m365SyncState.feedKey, feedKey));

    // The stored delta token still points at a valid batch (NOT gone) — a
    // stale-but-alive token replay would otherwise happily reuse the frozen
    // window forever. Fresh batches simulate what a re-windowed query returns.
    fake.setCalendar('me', [{ pages: [{ upserts: [
      ev('e1', 'Dentist (rescheduled)', '2026-08-20T09:00:00.000Z', '2026-08-20T10:00:00.000Z'),
    ] }] }]);
    const results = await runCalendarSync(rt);
    expect(results.find((r) => r.feedKey === feedKey)!.status).toBe('ok');

    // Fresh window params were sent (not the stored deltaLink/token).
    const calls = deltaCallsFor(fake);
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall.query).toContain('startDateTime=');
    expect(lastCall.query).not.toContain('deltatoken');
    expect(lastCall.query).not.toContain('skiptoken');

    // Feed contents were REPLACED (e2 is gone), same as the 410 recovery path.
    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId)).toEqual(['e1']);
    expect(rows[0]!.title).toBe('Dentist (rescheduled)');
  });

  it('does NOT re-window a feed whose last full sync is recent — plain delta replay', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [
      ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z'),
      ev('e2', 'Soccer', '2026-08-02T14:00:00.000Z', '2026-08-02T15:00:00.000Z'),
    ] }] }]);
    await runCalendarSync(rt); // last full sync is "now" — well under the threshold

    // Next batch is a normal incremental delta: update e1, no mention of e2.
    fake.setCalendar('me', [
      { pages: [{ upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] },
      { pages: [{ upserts: [ev('e1', 'Dentist (moved)', '2026-08-01T11:00:00.000Z', '2026-08-01T12:00:00.000Z')] }] },
    ]);
    const results = await runCalendarSync(rt);
    expect(results.find((r) => r.feedKey === feedKey)!.status).toBe('ok');

    const calls = deltaCallsFor(fake);
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall.query).not.toContain('startDateTime=');
    expect(lastCall.query).toMatch(/deltatoken|skiptoken/);

    // e2 survives (merge, not replace) — proof this was a delta, not a re-window.
    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId).sort()).toEqual(['e1', 'e2']);
    expect(rows.find((r) => r.externalId === 'e1')!.title).toBe('Dentist (moved)');
  });

  it('records lastFullSyncAt on a full sync and leaves it untouched on a plain delta', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] }]);
    await runCalendarSync(rt); // initial pull is a full sync
    const afterInitial = (await rt.store.getSyncState(feedKey))!;
    expect(afterInitial.lastFullSyncAt).toBeTruthy();
    const firstStamp = afterInitial.lastFullSyncAt!.getTime();

    // A plain incremental delta must NOT move the stamp forward.
    fake.setCalendar('me', [
      { pages: [{ upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] },
      { pages: [{ upserts: [ev('e2', 'Soccer', '2026-08-02T14:00:00.000Z', '2026-08-02T15:00:00.000Z')] }] },
    ]);
    await runCalendarSync(rt);
    const afterDelta = (await rt.store.getSyncState(feedKey))!;
    expect(afterDelta.lastFullSyncAt!.getTime()).toBe(firstStamp);

    // Force the feed past the threshold and re-sync: the stamp advances.
    await db.update(m365SyncState).set({
      lastFullSyncAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    }).where(eq(m365SyncState.feedKey, feedKey));
    fake.setCalendar('me', [{ pages: [{ upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] }]);
    await runCalendarSync(rt);
    const afterRewindow = (await rt.store.getSyncState(feedKey))!;
    expect(afterRewindow.lastFullSyncAt!.getTime()).toBeGreaterThan(firstStamp);
  });
});

describe('m365 calendar mirror — recurring series (master enrichment)', () => {
  function masterFetches(fake: FakeGraph) {
    return fake.calls.filter((c) => c.method === 'GET' && /\/events\//.test(c.path));
  }

  it('mirrors sparse occurrences enriched from the master in the same pull; never mirrors the master itself', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [
      // The series master carries the ORIGINAL 1932 start — must never surface.
      ev('bday-master', 'Birthday Alice', '1932-05-01T00:00:00.000Z', '1932-05-02T00:00:00.000Z', { allDay: true, type: 'seriesMaster' }),
      ev('bday-2026', '', '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', { type: 'occurrence', seriesMasterId: 'bday-master' }),
      ev('bday-2027', '', '2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z', { type: 'occurrence', seriesMasterId: 'bday-master' }),
    ] }] }]);

    const results = await runCalendarSync(rt);
    expect(results.find((r) => r.feedKey === feedKey)!.status).toBe('ok');

    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId).sort()).toEqual(['bday-2026', 'bday-2027']);
    for (const row of rows) {
      expect(row.title).toBe('Birthday Alice');
      expect(row.allDay).toBe(true);
    }
    const first = rows.find((r) => r.externalId === 'bday-2026')!;
    expect(first.startAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(first.endAt.toISOString()).toBe('2026-08-02T00:00:00.000Z');
    // The master was in the pull — no GET /events/{id} round-trip.
    expect(masterFetches(fake)).toHaveLength(0);
  });

  it('fetches the master via GET /me/events/{id} when a delta delivers an occurrence without it', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] }]);
    await runCalendarSync(rt);

    fake.setEventById('me', ev('standup-master', 'Standup', '2025-01-06T08:00:00.000Z', '2025-01-06T08:15:00.000Z', { type: 'seriesMaster', location: 'Kitchen' }) as FakeCalEvent);
    fake.setCalendar('me', [
      { pages: [{ upserts: [] }] },
      { pages: [{ upserts: [
        ev('standup-2026-08-03', '', '2026-08-03T08:00:00.000Z', '2026-08-03T08:15:00.000Z', { type: 'occurrence', seriesMasterId: 'standup-master' }),
      ] }] },
    ]);
    const results = await runCalendarSync(rt);
    expect(results.find((r) => r.feedKey === feedKey)!.status).toBe('ok');

    const rows = await mirrorRows(feedKey);
    const occ = rows.find((r) => r.externalId === 'standup-2026-08-03')!;
    expect(occ.title).toBe('Standup');
    expect(occ.allDay).toBe(false);
    expect(occ.location).toBe('Kitchen');
    expect(occ.startAt.toISOString()).toBe('2026-08-03T08:00:00.000Z');
    const fetches = masterFetches(fake);
    expect(fetches).toHaveLength(1);
    expect(fetches[0]!.path).toBe('/v1.0/me/events/standup-master');
  });

  it('fetches a missing master only ONCE for multiple occurrences of the same series (per-pull cache)', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] }]);
    await runCalendarSync(rt);

    fake.setEventById('me', ev('standup-master', 'Standup', '2025-01-06T08:00:00.000Z', '2025-01-06T08:15:00.000Z', { type: 'seriesMaster' }) as FakeCalEvent);
    fake.setCalendar('me', [
      { pages: [{ upserts: [] }] },
      { pages: [{ upserts: [
        ev('standup-a', '', '2026-08-03T08:00:00.000Z', '2026-08-03T08:15:00.000Z', { type: 'occurrence', seriesMasterId: 'standup-master' }),
        ev('standup-b', '', '2026-08-04T08:00:00.000Z', '2026-08-04T08:15:00.000Z', { type: 'occurrence', seriesMasterId: 'standup-master' }),
      ] }] },
    ]);
    await runCalendarSync(rt);

    const rows = await mirrorRows(feedKey);
    expect(rows.filter((r) => r.title === 'Standup').map((r) => r.externalId).sort()).toEqual(['standup-a', 'standup-b']);
    expect(masterFetches(fake)).toHaveLength(1);
  });

  it('skips an occurrence whose master fetch 404s (series just deleted) without failing the pull', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] }]);
    await runCalendarSync(rt);

    // No setEventById — GET /events/gone-master returns 404.
    fake.setCalendar('me', [
      { pages: [{ upserts: [] }] },
      { pages: [{ upserts: [
        ev('orphan-occ', '', '2026-08-03T08:00:00.000Z', '2026-08-03T08:15:00.000Z', { type: 'occurrence', seriesMasterId: 'gone-master' }),
      ] }] },
    ]);
    const results = await runCalendarSync(rt);
    expect(results.find((r) => r.feedKey === feedKey)!.status).toBe('ok');

    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId)).toEqual(['e1']); // orphan skipped, pull intact
  });

  it('an exception keeps its own overrides and inherits the rest from the master', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [
      ev('party-master', 'Party', '2020-06-01T00:00:00.000Z', '2020-06-02T00:00:00.000Z', { allDay: true, type: 'seriesMaster' }),
      // Own subject, NO isAllDay on the wire → inherits allDay=true from master.
      ev('party-exc', 'Moved party', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z', { type: 'exception', seriesMasterId: 'party-master' }),
    ] }] }]);
    await runCalendarSync(rt);

    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId)).toEqual(['party-exc']);
    expect(rows[0]!.title).toBe('Moved party');
    expect(rows[0]!.allDay).toBe(true);
  });

  it('cascades a series deletion: @removed for the master removes its mirrored occurrences', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [
      ev('bday-master', 'Birthday Alice', '1932-05-01T00:00:00.000Z', '1932-05-02T00:00:00.000Z', { allDay: true, type: 'seriesMaster' }),
      ev('bday-2026', '', '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', { type: 'occurrence', seriesMasterId: 'bday-master' }),
      ev('bday-2027', '', '2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z', { type: 'occurrence', seriesMasterId: 'bday-master' }),
      ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z'),
    ] }] }]);
    await runCalendarSync(rt);
    expect((await mirrorRows(feedKey)).map((r) => r.externalId).sort()).toEqual(['bday-2026', 'bday-2027', 'e1']);

    // The whole series is deleted — Graph tombstones the MASTER id only.
    fake.setCalendar('me', [
      { pages: [{ upserts: [] }] },
      { pages: [{ removed: ['bday-master'] }] },
    ]);
    await runCalendarSync(rt);

    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId)).toEqual(['e1']);
  });

  it('self-heals a master row mirrored by the old buggy provider when the master reappears in a delta', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [{ upserts: [ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z')] }] }]);
    await runCalendarSync(rt);

    // A bad row the pre-fix provider mirrored: the MASTER at its 1932 start.
    await db.insert(calendarMirrorEvents).values({
      source: 'm365', feedKey, externalId: 'bday-master', memberId: adult.user.id,
      title: 'Birthday Alice', allDay: true,
      startAt: new Date('1932-05-01T00:00:00.000Z'), endAt: new Date('1932-05-02T00:00:00.000Z'),
    });

    // An incremental delta re-delivers the master alongside a fresh occurrence.
    fake.setCalendar('me', [
      { pages: [{ upserts: [] }] },
      { pages: [{ upserts: [
        ev('bday-master', 'Birthday Alice', '1932-05-01T00:00:00.000Z', '1932-05-02T00:00:00.000Z', { allDay: true, type: 'seriesMaster' }),
        ev('bday-2026', '', '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', { type: 'occurrence', seriesMasterId: 'bday-master' }),
      ] }] },
    ]);
    const results = await runCalendarSync(rt);
    expect(results.find((r) => r.feedKey === feedKey)!.status).toBe('ok');

    const rows = await mirrorRows(feedKey);
    // The 1932 master row is gone; the enriched occurrence (same pull) survives.
    expect(rows.map((r) => r.externalId).sort()).toEqual(['bday-2026', 'e1']);
    const occ = rows.find((r) => r.externalId === 'bday-2026')!;
    expect(occ.title).toBe('Birthday Alice');
    expect(occ.startAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('keeps occurrences that a delta does NOT re-deliver when their still-alive master reappears', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    // Initial pull: master + 3 sparse occurrences → 3 mirrored rows.
    fake.setCalendar('me', [{ pages: [{ upserts: [
      ev('train-master', 'Weekly training', '2025-01-06T17:00:00.000Z', '2025-01-06T18:00:00.000Z', { type: 'seriesMaster' }),
      ev('train-o1', '', '2026-08-03T17:00:00.000Z', '2026-08-03T18:00:00.000Z', { type: 'occurrence', seriesMasterId: 'train-master' }),
      ev('train-o2', '', '2026-08-10T17:00:00.000Z', '2026-08-10T18:00:00.000Z', { type: 'occurrence', seriesMasterId: 'train-master' }),
      ev('train-o3', '', '2026-08-17T17:00:00.000Z', '2026-08-17T18:00:00.000Z', { type: 'occurrence', seriesMasterId: 'train-master' }),
    ] }] }]);
    await runCalendarSync(rt);
    expect((await mirrorRows(feedKey)).map((r) => r.externalId).sort())
      .toEqual(['train-o1', 'train-o2', 'train-o3']);

    // One occurrence is edited: the incremental delta re-delivers the ALIVE
    // master plus only the changed exception — o1/o3 are NOT re-delivered and
    // must survive (the master purge must not cascade over the whole series).
    fake.setCalendar('me', [
      { pages: [{ upserts: [] }] },
      { pages: [{ upserts: [
        ev('train-master', 'Weekly training', '2025-01-06T17:00:00.000Z', '2025-01-06T18:00:00.000Z', { type: 'seriesMaster' }),
        ev('train-o2', 'Training (moved)', '2026-08-11T17:00:00.000Z', '2026-08-11T18:00:00.000Z', { type: 'exception', seriesMasterId: 'train-master' }),
      ] }] },
    ]);
    const results = await runCalendarSync(rt);
    expect(results.find((r) => r.feedKey === feedKey)!.status).toBe('ok');

    const rows = await mirrorRows(feedKey);
    // o1 and o3 still exist; the master is still not mirrored.
    expect(rows.map((r) => r.externalId).sort()).toEqual(['train-o1', 'train-o2', 'train-o3']);
    const o2 = rows.find((r) => r.externalId === 'train-o2')!;
    expect(o2.title).toBe('Training (moved)');
    expect(o2.startAt.toISOString()).toBe('2026-08-11T17:00:00.000Z');
  });

  it('is order-independent within a pull: occurrences on page 1, master on page 2, no /events fetch', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedConnectedMember(rt);
    const feedKey = feedKeys.calendarMember(adult.user.id);

    fake.setCalendar('me', [{ pages: [
      { upserts: [
        ev('bday-2026', '', '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', { type: 'occurrence', seriesMasterId: 'bday-master' }),
        ev('bday-2027', '', '2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z', { type: 'occurrence', seriesMasterId: 'bday-master' }),
      ] },
      { upserts: [
        ev('bday-master', 'Birthday Alice', '1932-05-01T00:00:00.000Z', '1932-05-02T00:00:00.000Z', { allDay: true, type: 'seriesMaster' }),
      ] },
    ] }]);
    await runCalendarSync(rt);

    const rows = await mirrorRows(feedKey);
    expect(rows.map((r) => r.externalId).sort()).toEqual(['bday-2026', 'bday-2027']);
    for (const row of rows) expect(row.title).toBe('Birthday Alice');
    expect(masterFetches(fake)).toHaveLength(0);
  });
});

describe('m365 calendar mirror — visibility + read-only', () => {
  async function syncOneMemberEvent() {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const seeded = await seedConnectedMember(rt);
    fake.setCalendar('me', [{ pages: [{ upserts: [
      ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z'),
    ] }] }]);
    await runCalendarSync(rt);
    const [row] = await mirrorRows(feedKeys.calendarMember(seeded.adult.user.id));
    return { seeded, mirrorId: row!.id };
  }

  it('mirrored events appear in the existing range query alongside native events', async () => {
    const { seeded } = await syncOneMemberEvent();
    // A native event in the same window.
    await calendar.createEvent(
      { title: 'Native', startAt: '2026-08-01T12:00:00.000Z', endAt: '2026-08-01T13:00:00.000Z', allDay: false, attendeeIds: [] } as never,
      seeded.adult.user.id,
    );
    const { rows } = await calendar.listEvents({ from: WINDOW.from, to: WINDOW.to });
    const sources = (rows as Array<{ title: string; source: string }>).map((r) => `${r.source}:${r.title}`);
    expect(sources).toContain('m365:Dentist');
    expect(sources).toContain('native:Native');
  });

  it('rejects a REST update/delete of a mirrored event with a read-only error', async () => {
    const { seeded, mirrorId } = await syncOneMemberEvent();
    const app = new Hono();
    app.route('/api/v1/events', calendarRouter);

    const patch = await app.request(`/api/v1/events/${mirrorId}`, {
      method: 'PATCH', headers: authHeaders(seeded.admin.jwt), body: JSON.stringify({ title: 'Hijack' }),
    });
    expect(patch.status).toBe(403);
    expect((await patch.json() as { error: { code: string } }).error.code).toBe('EVENT_READ_ONLY');

    const del = await app.request(`/api/v1/events/${mirrorId}`, {
      method: 'DELETE', headers: authHeaders(seeded.admin.jwt),
    });
    expect(del.status).toBe(403);
  });

  it('rejects an MCP update of a mirrored event', async () => {
    const { seeded, mirrorId } = await syncOneMemberEvent();
    await expect(invokeTool(calendarTools, 'calendar.update_event',
      { userId: seeded.admin.user.id, role: 'admin' }, { id: mirrorId, title: 'Hijack' },
    )).rejects.toThrow(/read-only/i);
  });

  it('service.updateEvent throws ReadOnlyEventError for a mirrored id', async () => {
    const { mirrorId } = await syncOneMemberEvent();
    await expect(calendar.updateEvent(mirrorId, { title: 'x' } as never)).rejects.toThrow(calendar.ReadOnlyEventError);
  });
});

describe('m365 sync route + health surface', () => {
  function enabledApp() {
    const app = new Hono();
    app.route('/api/v1/m365', m365Router);
    return app;
  }

  it('POST /sync (admin) drives a sync and GET /status exposes per-feed state', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    setM365Runtime(rt);
    const { admin, adult } = await seedConnectedMember(rt);
    fake.setCalendar('me', [{ pages: [{ upserts: [
      ev('e1', 'Dentist', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z'),
    ] }] }]);

    const sync = await enabledApp().request('/api/v1/m365/sync', { method: 'POST', headers: authHeaders(admin.jwt) });
    expect(sync.status).toBe(200);
    const syncBody = await sync.json() as { data: { results: Array<{ feedKey: string; status: string }> } };
    expect(syncBody.data.results.some((r) => r.status === 'ok')).toBe(true);

    // Admin sees all feed states; the delta token is NOT exposed.
    const statusAdmin = await enabledApp().request('/api/v1/m365/status', { headers: authHeaders(admin.jwt) });
    const adminBody = await statusAdmin.json() as { data: { feeds: Array<Record<string, unknown>> } };
    const memberFeed = adminBody.data.feeds.find((f) => f['feedKey'] === feedKeys.calendarMember(adult.user.id))!;
    expect(memberFeed['lastSuccessAt']).toBeTruthy();
    expect(memberFeed).not.toHaveProperty('deltaToken');

    // A member sees only their own + family feed state.
    const statusMember = await enabledApp().request('/api/v1/m365/status', { headers: authHeaders(adult.jwt) });
    const memberBody = await statusMember.json() as { data: { feeds: Array<{ feedKey: string }> } };
    const keys = memberBody.data.feeds.map((f) => f.feedKey);
    expect(keys).toContain(feedKeys.calendarMember(adult.user.id));
    expect(keys.every((k) => k === feedKeys.calendarMember(adult.user.id) || k === feedKeys.calendarFamily())).toBe(true);
  });

  it('POST /sync is admin-only', async () => {
    const fake = createFakeGraph();
    setM365Runtime(runtimeForFakeGraph(fake));
    const { adult } = await seedTestHousehold();
    const res = await enabledApp().request('/api/v1/m365/sync', { method: 'POST', headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(403);
  });
});
