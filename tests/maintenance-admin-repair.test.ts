import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';
import { db } from '../src/db/index.js';
import { repairMaintenanceAdmin } from '../src/household/maintenance-admin.js';
import { events, eventAttendees } from '../src/modules/calendar/schema.js';
import { recipes, mealPlanEntries } from '../src/modules/meals/schema.js';
import { todoListAllowlist } from '../src/modules/tasks/schema.js';
import { setAllowlist } from '../src/modules/tasks/store.js';
import { calendarAllowlist } from '../src/modules/calendar/allowlist-schema.js';
import { calendarMirrorEvents } from '../src/modules/calendar/mirror-schema.js';
import { setCalendarAllowlist, setHouseholdCalendar } from '../src/modules/calendar/allowlist-store.js';
import { integrationSyncState } from '../src/integrations/schema.js';
import { feedKeys } from '../src/integrations/feed-keys.js';
import { clearProviders } from '../src/integrations/registry.js';
import type { TaskProvider } from '../src/modules/tasks/providers/types.js';
import { identity, householdCore } from '../src/wiring.js';
import { seedTestHousehold, registerFakeTaskProvider } from './helpers.js';

const CREDS = { adminEmail: 'admin@test.local', adminPassword: 'test-admin-password' };

/** Inert task provider — only its presence in the registry matters here. */
function stubTaskProvider(): TaskProvider {
  return {
    source: 'stub',
    listAvailableLists: async () => [],
    pullChanges: async () => ({ upserts: [], deletions: [], nextToken: null, fullResync: true }),
    setCompleted: async () => {},
    createTask: async () => { throw new Error('not used'); },
  };
}

describe('repairMaintenanceAdmin', () => {
  afterEach(() => {
    clearProviders();
  });

  it('seeds the admin when absent', async () => {
    await householdCore.seedHousehold({ name: 'Test Household' });
    const { adminId } = await repairMaintenanceAdmin(CREDS);

    const [row] = await db.select().from(users).where(eq(users.id, adminId));
    expect(row!.handle).toBe('admin');
    expect(row!.role).toBe('admin');
    expect(row!.email).toBe('admin@test.local');
  });

  it('rotates ADMIN_EMAIL in place without creating a second admin', async () => {
    await seedTestHousehold();
    await repairMaintenanceAdmin({ ...CREDS, adminEmail: 'newadmin@test.local' });

    const admins = await db.select().from(users).where(eq(users.handle, 'admin'));
    expect(admins).toHaveLength(1);
    expect(admins[0]!.email).toBe('newadmin@test.local');
  });

  it('re-syncs a changed password so env stays the source of truth', async () => {
    await seedTestHousehold();
    const [before] = await db.select().from(users).where(eq(users.handle, 'admin'));

    await repairMaintenanceAdmin({ ...CREDS, adminPassword: 'a-brand-new-password' });

    const [after] = await db.select().from(users).where(eq(users.handle, 'admin'));
    expect(after!.passwordHash).not.toBe(before!.passwordHash);

    // The repair must leave a USABLE credential, not just a different hash.
    const authed = await identity.authenticate('admin@test.local', 'a-brand-new-password');
    expect(authed).not.toBeNull();
  });

  it('restores the admin role if it drifted', async () => {
    const { admin } = await seedTestHousehold();
    await db.update(users).set({ role: 'child' }).where(eq(users.id, admin.user.id));

    await repairMaintenanceAdmin(CREDS);

    const [row] = await db.select().from(users).where(eq(users.id, admin.user.id));
    expect(row!.role).toBe('admin');
  });

  it('fails loudly when ADMIN_EMAIL is held by a different member', async () => {
    await seedTestHousehold();
    await identity.createUser({
      email: 'squatter@test.local', handle: 'squatter', password: 'pw-squatter-1',
      role: 'adult', displayName: 'Squatter', avatarColor: 'sky',
    });

    await expect(
      repairMaintenanceAdmin({ ...CREDS, adminEmail: 'squatter@test.local' }),
    ).rejects.toThrow(/already held/i);
  });

  it('fails loudly on the seed branch too, when no admin is anchored yet', async () => {
    await householdCore.seedHousehold({ name: 'Test Household' });
    await identity.createUser({
      email: 'squatter@test.local', handle: 'squatter', password: 'pw-squatter-1',
      role: 'adult', displayName: 'Squatter', avatarColor: 'sky',
    });

    await expect(
      repairMaintenanceAdmin({ ...CREDS, adminEmail: 'squatter@test.local' }),
    ).rejects.toThrow(/already held/i);

    const admins = await db.select().from(users).where(eq(users.handle, 'admin'));
    expect(admins).toHaveLength(0);
  });

  it('strips admin-owned household data and repoints creators', async () => {
    const { admin, adult } = await seedTestHousehold();
    const [event] = await db.insert(events).values({
      title: 'Admin event', startAt: new Date(), endAt: new Date(), createdBy: admin.user.id,
    }).returning();
    await db.insert(eventAttendees).values({ eventId: event!.id, memberId: admin.user.id });
    await db.insert(recipes).values({ title: 'Admin recipe', createdBy: admin.user.id });
    await db.insert(mealPlanEntries).values({
      date: '2026-08-04', slot: 'supper', cook: admin.user.id, helper: admin.user.id,
    });

    await repairMaintenanceAdmin(CREDS);

    expect(await db.select().from(eventAttendees)).toHaveLength(0);
    const [ev] = await db.select().from(events);
    expect(ev!.createdBy).toBe(adult.user.id);
    const [rec] = await db.select().from(recipes);
    expect(rec!.createdBy).toBe(adult.user.id);
    const [entry] = await db.select().from(mealPlanEntries);
    expect(entry!.cook).toBeNull();
    expect(entry!.helper).toBeNull();
  });

  it('cleans up m365_sync_state rows for the admin-owned feeds (calendar + allowlisted To Do lists)', async () => {
    const { admin } = await seedTestHousehold();
    // The default-calendar feed key is now built from the REGISTERED provider
    // list (Task 13), not hardcoded — so m365 must be registered for this
    // scenario to model "the admin had connected M365 in the past".
    registerFakeTaskProvider('m365', stubTaskProvider());

    // Simulate the admin having connected M365 in the past: an allowlisted list
    // and sync state for both its calendar feed and its To Do feed, PLUS a
    // feed belonging to someone else that must survive untouched.
    await db.insert(todoListAllowlist).values({
      memberId: admin.user.id, listId: 'list-1', listName: 'Admin List',
    });
    const adminCalendarKey = feedKeys.calendarMember('m365', admin.user.id);
    const adminTodoKey = feedKeys.todoMember('m365', admin.user.id, 'list-1');
    const familyKey = feedKeys.calendarFamily('m365');
    await db.insert(integrationSyncState).values([
      { feedKey: adminCalendarKey, lastError: null },
      { feedKey: adminTodoKey, lastError: null },
      { feedKey: familyKey, lastError: null },
    ]);

    await repairMaintenanceAdmin(CREDS);

    const remaining = await db.select().from(integrationSyncState);
    const remainingKeys = remaining.map((r) => r.feedKey);
    expect(remainingKeys).not.toContain(adminCalendarKey);
    expect(remainingKeys).not.toContain(adminTodoKey);
    expect(remainingKeys).toContain(familyKey);
  });

  it('is idempotent', async () => {
    const { admin } = await seedTestHousehold();
    await db.insert(recipes).values({ title: 'Admin recipe', createdBy: admin.user.id });

    await repairMaintenanceAdmin(CREDS);
    const [before] = await db.select().from(users).where(eq(users.handle, 'admin'));

    await expect(repairMaintenanceAdmin(CREDS)).resolves.toBeDefined();

    const admins = await db.select().from(users).where(eq(users.handle, 'admin'));
    expect(admins).toHaveLength(1);
    // seedTestHousehold's admin password is exactly CREDS.adminPassword, so a
    // second repair with unchanged env credentials must NOT rewrite the hash.
    // This is what pins verifyPassword's (hash, plain) argument order forever:
    // a reversed call, or a deleted comparison, would rewrite it every time.
    expect(admins[0]!.passwordHash).toBe(before!.passwordHash);
  });

  it('skips creator repointing when no non-admin member exists, but still strips other admin data', async () => {
    await householdCore.seedHousehold({ name: 'Test Household' });
    const { adminId } = await repairMaintenanceAdmin(CREDS);
    const [event] = await db.insert(events).values({
      title: 'Lonely event', startAt: new Date(), endAt: new Date(), createdBy: adminId,
    }).returning();
    await db.insert(eventAttendees).values({ eventId: event!.id, memberId: adminId });
    await db.insert(recipes).values({ title: 'Lonely recipe', createdBy: adminId });

    await expect(repairMaintenanceAdmin(CREDS)).resolves.toBeDefined();

    const [rec] = await db.select().from(recipes);
    expect(rec!.createdBy).toBe(adminId); // left alone; repaired on a later boot
    // Deletions that don't need a heir (unlike created_by repointing) still happen.
    expect(await db.select().from(eventAttendees)).toHaveLength(0);
  });

  it('clears the admin\'s stale feed state for EVERY registered provider', async () => {
    // `CREDS` and `repairMaintenanceAdmin` are this suite's existing top-level
    // constants/imports; seedTestHousehold's `admin` IS the maintenance admin.
    const { admin } = await seedTestHousehold();
    const adminId = admin.user.id;
    registerFakeTaskProvider('m365', stubTaskProvider());
    registerFakeTaskProvider('google', stubTaskProvider());

    await setAllowlist(adminId, 'm365', [{ id: 'outlook-1', name: 'Outlook' }]);
    await setAllowlist(adminId, 'google', [{ id: 'g-1', name: 'Haushalt' }]);
    await setCalendarAllowlist(adminId, 'google', [{ id: 'cal-a', name: 'Anna' }]);

    for (const feedKey of [
      `m365:calendar:member:${adminId}`,
      `m365:todo:member:${adminId}:outlook-1`,
      `google:calendar:member:${adminId}`,
      `google:todo:member:${adminId}:g-1`,
      `google:calendar:member:${adminId}:cal-a`,
    ]) {
      await db.insert(integrationSyncState).values({ feedKey, lastSuccessAt: new Date() });
    }

    // A household-designated feed mirrors with memberId = null — the case a
    // member-keyed delete cannot see.
    await setHouseholdCalendar(adminId, 'google', 'cal-a');
    await db.insert(calendarMirrorEvents).values({
      source: 'google', feedKey: `google:calendar:member:${adminId}:cal-a`,
      externalId: 'ev-shared', memberId: null, title: 'Müllabfuhr',
      startAt: new Date('2026-09-01T06:00:00Z'), endAt: new Date('2026-09-01T06:30:00Z'),
    });

    await repairMaintenanceAdmin(CREDS);

    const left = await db.select().from(integrationSyncState);
    expect(left).toEqual([]);
    expect(await db.select().from(calendarAllowlist)).toEqual([]);
    expect(await db.select().from(calendarMirrorEvents)).toEqual([]);
  });
});
