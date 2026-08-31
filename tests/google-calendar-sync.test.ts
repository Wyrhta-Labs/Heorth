import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedTestHousehold } from './helpers.js';
import { createFakeGoogle, runtimeForFakeGoogle, type FakeGoogle } from './fake-google.js';
import { GoogleCalendarProvider } from '../src/google/calendar-provider.js';
import {
  setCalendarAllowlist, setHouseholdCalendar,
} from '../src/modules/calendar/allowlist-store.js';
import type { GoogleRuntime } from '../src/google/runtime.js';
import { db } from '../src/db/index.js';
import { calendarMirrorEvents } from '../src/modules/calendar/mirror-schema.js';
import { runGoogleCalendarSync } from '../src/google/calendar-sync.js';

let fake: FakeGoogle;
let rt: GoogleRuntime;
// A fixed household zone keeps the all-day and date-only assertions deterministic.
const provider = () => new GoogleCalendarProvider(rt, async () => 'Europe/Berlin');

beforeEach(() => {
  fake = createFakeGoogle();
  rt = runtimeForFakeGoogle(fake);
});

async function connectedMember() {
  const { adult } = await seedTestHousehold();
  await rt.store.upsertConnection({
    memberId: adult.user.id, accountLabel: 'a@gmail.test', refreshToken: 'r', scopes: '',
  });
  return adult.user.id;
}

describe('GoogleCalendarProvider.listAvailableCalendars', () => {
  it('reports the member\'s calendars', async () => {
    const memberId = await connectedMember();
    fake.setCalendars([{ id: 'cal-a', summary: 'Anna' }, { id: 'cal-b', summary: 'Sport' }]);
    expect(await provider().listAvailableCalendars(memberId)).toEqual([
      { id: 'cal-a', name: 'Anna' }, { id: 'cal-b', name: 'Sport' },
    ]);
  });
});

describe('GoogleCalendarProvider.listFeeds', () => {
  it('enumerates allowlisted calendars only, as member feeds', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    expect(await provider().listFeeds()).toEqual([
      { feedKey: `google:calendar:member:${memberId}:cal-a`, memberId, kind: 'member' },
    ]);
  });

  it('reports the designated calendar as a FAMILY feed still owned by its member', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    await setHouseholdCalendar(memberId, 'google', 'cal-a');
    const [feed] = await provider().listFeeds();
    // kind drives attribution; memberId stays set because the pull runs on THAT
    // member's delegated token and the runner needs it for the health check.
    expect(feed).toEqual({ feedKey: `google:calendar:member:${memberId}:cal-a`, memberId, kind: 'family' });
  });
});

describe('GoogleCalendarProvider.pullChanges', () => {
  it('does a windowed full pull with no token, and mirrors normalized events', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [{
      id: 'ev-1', summary: 'Dentist', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z',
      location: 'Praxis', organizer: 'Anna', timeZone: 'Europe/Berlin',
    }] }] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null);

    expect(out.fullResync).toBe(true);
    expect(out.masterPurges).toEqual([]);
    expect(out.upserts).toEqual([{
      externalId: 'ev-1', title: 'Dentist',
      start: { utc: '2026-09-01T09:00:00.000Z', timeZone: 'Europe/Berlin' },
      end: { utc: '2026-09-01T10:00:00.000Z', timeZone: 'Europe/Berlin' },
      allDay: false, location: 'Praxis', organizer: 'Anna', memberId, seriesMasterId: null,
    }]);
    const call = fake.calls.find((c) => c.path.includes('/events'))!;
    expect(call.query).toContain('singleEvents=true');
    expect(call.query).toContain('timeMin=');
    // Without this Google never delivers a cancelled event, so a deletion at
    // the source would never reach the mirror.
    expect(call.query).toContain('showDeleted=true');
  });

  it('replays the sync token WITHOUT a window on an incremental pull', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [] }] }, { pages: [{ events: [] }] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, '1.0');

    expect(out.fullResync).toBe(false);
    const call = fake.calls.filter((c) => c.path.includes('/events')).at(-1)!;
    // Google rejects timeMin/timeMax alongside a syncToken with a 400.
    expect(call.query).toContain('syncToken=1.0');
    expect(call.query).toContain('showDeleted=true');
    expect(call.query).not.toContain('timeMin=');
  });

  it('maps a cancelled event to a deletion', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-gone', status: 'cancelled' },
      { id: 'ev-live', summary: 'Live', startUtc: '2026-09-02T09:00:00Z', endUtc: '2026-09-02T10:00:00Z' },
    ] }] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null);
    expect(out.deletions).toEqual(['ev-gone']);
    expect(out.upserts.map((e) => e.externalId)).toEqual(['ev-live']);
  });

  it('anchors an all-day event to household-local midnight and flags allDay', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-holiday', summary: 'Ferien', startDate: '2026-09-05', endDate: '2026-09-06' },
    ] }] }]);

    const [ev] = (await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null)).upserts;
    expect(ev!.allDay).toBe(true);
    // Berlin is UTC+2 in September: local midnight is 22:00Z the day before.
    expect(ev!.start.utc).toBe('2026-09-04T22:00:00.000Z');
    expect(ev!.end.utc).toBe('2026-09-05T22:00:00.000Z');
  });

  it('carries recurringEventId across as seriesMasterId and never emits a master purge', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-occ', summary: 'Turnen', startUtc: '2026-09-03T15:00:00Z', endUtc: '2026-09-03T16:00:00Z',
        recurringEventId: 'series-1' },
    ] }] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null);
    expect(out.upserts[0]!.seriesMasterId).toBe('series-1');
    // singleEvents=true means Google never delivers a series master, so the
    // Graph-specific hazard masterPurges exists for cannot arise here.
    expect(out.masterPurges).toEqual([]);
  });

  it('attributes the designated household feed to no member', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    await setHouseholdCalendar(memberId, 'google', 'cal-a');
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-1', summary: 'Müllabfuhr', startUtc: '2026-09-01T06:00:00Z', endUtc: '2026-09-01T06:30:00Z' },
    ] }] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null);
    expect(out.upserts[0]!.memberId).toBeNull();
  });

  it('recovers from a 410 by re-windowing and reporting a full resync', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [
      { pages: [{ events: [{ id: 'ev-fresh', summary: 'Fresh', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' }] }] },
      { pages: [], gone: true },
    ]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, '1.0');
    expect(out.fullResync).toBe(true);
    expect(out.upserts.map((e) => e.externalId)).toEqual(['ev-fresh']);
  });

  it('follows nextPageToken to exhaustion', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [
      { events: [{ id: 'ev-1', summary: 'One', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' }] },
      { events: [{ id: 'ev-2', summary: 'Two', startUtc: '2026-09-02T09:00:00Z', endUtc: '2026-09-02T10:00:00Z' }] },
    ] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null);
    expect(out.upserts.map((e) => e.externalId)).toEqual(['ev-1', 'ev-2']);
    expect(out.nextToken).toBe('1.0');
  });

  it('pages an INCREMENTAL pull too, repeating the query and adding pageToken', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [
      { pages: [{ events: [] }] },
      { pages: [
        { events: [{ id: 'ev-3', summary: 'Three', startUtc: '2026-09-03T09:00:00Z', endUtc: '2026-09-03T10:00:00Z' }] },
        { events: [{ id: 'ev-4', summary: 'Four', startUtc: '2026-09-04T09:00:00Z', endUtc: '2026-09-04T10:00:00Z' }] },
      ] },
    ]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, '1.0');

    // The second page must carry BOTH the original syncToken and the pageToken.
    // Sending pageToken alone, or re-deriving the query, breaks the chain.
    expect(out.upserts.map((e) => e.externalId)).toEqual(['ev-3', 'ev-4']);
    const second = fake.calls.filter((c) => c.path.includes('/events')).at(-1)!;
    expect(second.query).toContain('pageToken=');
    expect(second.query).toContain('syncToken=1.0');
  });

  it('refuses a feed key with no allowlist row', async () => {
    const memberId = await connectedMember();
    await expect(
      provider().pullChanges(`google:calendar:member:${memberId}:not-allowlisted`, null),
    ).rejects.toThrow(/Unknown Google calendar feed/);
  });
});

describe('runGoogleCalendarSync', () => {
  it('writes the mirror and records per-feed success', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-1', summary: 'Dentist', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' },
    ] }] }]);

    const results = await runGoogleCalendarSync(rt, provider());
    expect(results).toEqual([{
      feedKey: `google:calendar:member:${memberId}:cal-a`, status: 'ok', upserted: 1, deleted: 0,
    }]);

    const rows = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.source, 'google'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Dentist');
  });

  it('skips a feed whose member has no connection', async () => {
    const { child } = await seedTestHousehold();
    await setCalendarAllowlist(child.user.id, 'google', [{ id: 'cal-x', name: 'X' }]);
    const results = await runGoogleCalendarSync(rt, provider());
    expect(results).toEqual([{
      feedKey: `google:calendar:member:${child.user.id}:cal-x`, status: 'skipped', reason: 'no_connection',
    }]);
  });

  it('classifies an upstream failure as google_<status>, never graph_<n>', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.failEvents.add('cal-a');

    const [result] = await runGoogleCalendarSync(rt, provider());
    expect(result).toMatchObject({ status: 'error', reason: 'google_500' });
    const state = await rt.store.getSyncState(`google:calendar:member:${memberId}:cal-a`);
    expect(state!.lastError).toBe('google_500');
  });

  it('reconciles a full pull: an event absent from the snapshot is deleted, survivors keep their id', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-1', summary: 'Stays', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' },
      { id: 'ev-2', summary: 'Goes', startUtc: '2026-09-02T09:00:00Z', endUtc: '2026-09-02T10:00:00Z' },
    ] }] }]);
    await runGoogleCalendarSync(rt, provider());
    const before = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.externalId, 'ev-1'));

    // A second FULL pull carrying only ev-1.
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-1', summary: 'Stays', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' },
    ] }] }]);
    await rt.store.recordSyncSuccess(`google:calendar:member:${memberId}:cal-a`, null, false);
    await runGoogleCalendarSync(rt, provider());

    const after = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.source, 'google'));
    expect(after.map((r) => r.externalId)).toEqual(['ev-1']);
    expect(after[0]!.id).toBe(before[0]!.id);
  });

  it('re-attributes a feed\'s mirrored rows when it is designated the household calendar', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-1', summary: 'Dentist', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' },
    ] }] }]);
    await runGoogleCalendarSync(rt, provider());

    const before = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.externalId, 'ev-1'));
    expect(before[0]!.memberId).toBe(memberId);

    // Designating the calendar as the household calendar clears its sync
    // token, forcing the next sync to be a fresh full pull.
    await setHouseholdCalendar(memberId, 'google', 'cal-a');
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-1', summary: 'Dentist', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' },
    ] }] }]);
    await runGoogleCalendarSync(rt, provider());

    const after = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.externalId, 'ev-1'));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[0]!.memberId).toBeNull();
  });
});
