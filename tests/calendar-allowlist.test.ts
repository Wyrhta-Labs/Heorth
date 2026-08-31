import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { seedTestHousehold } from './helpers.js';
import { integrationSyncState } from '../src/integrations/schema.js';
import { calendarMirrorEvents } from '../src/modules/calendar/mirror-schema.js';
import {
  getCalendarAllowlist, setCalendarAllowlist, listAllowlistedCalendarFeeds,
  getCalendarFeedByKey, getHouseholdCalendar, setHouseholdCalendar,
} from '../src/modules/calendar/allowlist-store.js';

describe('calendar allowlist store', () => {
  it('starts empty — nothing syncs by default', async () => {
    const { adult } = await seedTestHousehold();
    expect(await getCalendarAllowlist(adult.user.id)).toEqual([]);
    expect(await listAllowlistedCalendarFeeds('google')).toEqual([]);
  });

  it('replaces a member selection and builds provider-prefixed feed keys', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [
      { id: 'cal-primary', name: 'Primary' },
      { id: 'cal-sport', name: 'Sport' },
    ]);
    const feeds = await listAllowlistedCalendarFeeds('google');
    expect(feeds.map((f) => f.feedKey).sort()).toEqual([
      `google:calendar:member:${adult.user.id}:cal-primary`,
      `google:calendar:member:${adult.user.id}:cal-sport`,
    ]);
  });

  it('drops a de-selected calendar and clears its mirrored events', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-sport', name: 'Sport' }]);
    const feedKey = `google:calendar:member:${adult.user.id}:cal-sport`;
    await db.insert(calendarMirrorEvents).values({
      source: 'google', feedKey, externalId: 'ev-1', memberId: adult.user.id,
      title: 'Match', startAt: new Date('2026-09-01T09:00:00Z'), endAt: new Date('2026-09-01T10:00:00Z'),
    });

    await setCalendarAllowlist(adult.user.id, 'google', []);

    expect(await getCalendarAllowlist(adult.user.id, 'google')).toEqual([]);
    const left = await db.select().from(calendarMirrorEvents).where(eq(calendarMirrorEvents.feedKey, feedKey));
    expect(left).toEqual([]);
  });

  it('clears a de-selected feed\'s sync state, so no frozen row lingers in /status', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-sport', name: 'Sport' }]);
    const feedKey = `google:calendar:member:${adult.user.id}:cal-sport`;
    await db.insert(integrationSyncState).values({ feedKey, syncToken: 'tok', lastSuccessAt: new Date() });

    await setCalendarAllowlist(adult.user.id, 'google', []);

    const left = await db.select().from(integrationSyncState)
      .where(eq(integrationSyncState.feedKey, feedKey));
    expect(left).toEqual([]);
  });

  it('resolves a feed by its key without parsing it', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal:with:colons', name: 'Odd' }]);
    const feed = await getCalendarFeedByKey(`google:calendar:member:${adult.user.id}:cal:with:colons`);
    expect(feed).toMatchObject({ provider: 'google', calendarId: 'cal:with:colons', memberId: adult.user.id });
  });

  it('designates exactly one household calendar, household-wide', async () => {
    const { adult, child } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-a', name: 'A' }]);
    await setCalendarAllowlist(child.user.id, 'google', [{ id: 'cal-b', name: 'B' }]);

    await setHouseholdCalendar(adult.user.id, 'google', 'cal-a');
    expect(await getHouseholdCalendar()).toMatchObject({ memberId: adult.user.id, calendarId: 'cal-a' });

    await setHouseholdCalendar(child.user.id, 'google', 'cal-b');
    expect(await getHouseholdCalendar()).toMatchObject({ memberId: child.user.id, calendarId: 'cal-b' });
    const all = [
      ...(await getCalendarAllowlist(adult.user.id, 'google')),
      ...(await getCalendarAllowlist(child.user.id, 'google')),
    ];
    expect(all.filter((r) => r.isHousehold)).toHaveLength(1);
  });

  it('clears the feed sync token when a designation changes, forcing a re-attribution resync', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-a', name: 'A' }]);
    const feedKey = `google:calendar:member:${adult.user.id}:cal-a`;
    await db.insert(integrationSyncState).values({
      feedKey, syncToken: 'tok-1', lastFullSyncAt: new Date(),
    });

    await setHouseholdCalendar(adult.user.id, 'google', 'cal-a');

    const [state] = await db.select().from(integrationSyncState)
      .where(eq(integrationSyncState.feedKey, feedKey));
    expect(state!.syncToken).toBeNull();
    expect(state!.lastFullSyncAt).toBeNull();
  });

  it('clears sync tokens on BOTH the newly- and previously-designated feeds', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [
      { id: 'cal-a', name: 'A' },
      { id: 'cal-b', name: 'B' },
    ]);
    const feedKeyA = `google:calendar:member:${adult.user.id}:cal-a`;
    const feedKeyB = `google:calendar:member:${adult.user.id}:cal-b`;
    await db.insert(integrationSyncState).values([
      { feedKey: feedKeyA, syncToken: 'tok-a', lastFullSyncAt: new Date() },
      { feedKey: feedKeyB, syncToken: 'tok-b', lastFullSyncAt: new Date() },
    ]);

    await setHouseholdCalendar(adult.user.id, 'google', 'cal-a');
    await setHouseholdCalendar(adult.user.id, 'google', 'cal-b');

    const [stateA] = await db.select().from(integrationSyncState)
      .where(eq(integrationSyncState.feedKey, feedKeyA));
    const [stateB] = await db.select().from(integrationSyncState)
      .where(eq(integrationSyncState.feedKey, feedKeyB));
    expect(stateA!.syncToken).toBeNull();
    expect(stateA!.lastFullSyncAt).toBeNull();
    expect(stateB!.syncToken).toBeNull();
    expect(stateB!.lastFullSyncAt).toBeNull();
  });

  it('rejects designating a calendar that is not allowlisted, leaving the prior designation intact', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-a', name: 'A' }]);
    await setHouseholdCalendar(adult.user.id, 'google', 'cal-a');

    await expect(
      setHouseholdCalendar(adult.user.id, 'google', 'cal-not-allowlisted'),
    ).rejects.toThrow();

    expect(await getHouseholdCalendar()).toMatchObject({ memberId: adult.user.id, calendarId: 'cal-a' });
  });
});
