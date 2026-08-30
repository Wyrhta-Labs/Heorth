import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { bootstrap, warnIfNoHouseholdList } from '../src/index.js';
import { db } from '../src/db/index.js';
import { todoListAllowlist } from '../src/modules/tasks/schema.js';
import { setHouseholdList } from '../src/modules/tasks/store.js';
import { household } from '@wyrhta/core/household';
import { users } from '@wyrhta/core/identity';
import { config } from '../src/config/env.js';
import { clearProviders, registerProvider } from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';

describe('bootstrap', () => {
  it('seeds the household and admin idempotently', async () => {
    await bootstrap();
    await bootstrap(); // second run must not create a duplicate household or admin

    const households = await db.select().from(household);
    expect(households.length).toBe(1);
    expect(households[0]!.name).toBe(config.householdName);

    const admins = await db.select().from(users).where(eq(users.role, 'admin'));
    expect(admins.length).toBe(1);
    expect(admins[0]!.email).toBe(config.adminEmail);
  });
});

describe('warnIfNoHouseholdList', () => {
  beforeEach(() => {
    clearProviders();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubProvider() {
    return {
      id: 'm365',
      store: new IntegrationStore('m365'),
      classifyError: () => 'error',
      fullResyncIntervalMs: 1000,
      authorizeUrl: (state: string) => `https://login.test/authorize?state=${state}`,
      completeConnect: async () => ({
        accountLabel: 'member@contoso.test', refreshToken: 'r', scopes: 'User.Read',
      }),
      calendar: null,
      tasks: null,
      runCalendarSync: async () => [],
      runTaskSync: async () => [],
    };
  }

  it('warns when a provider is registered and no household list is designated', async () => {
    const warnSpy = vi.spyOn(console, 'warn');
    registerProvider(stubProvider());

    await warnIfNoHouseholdList();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[integrations]'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('PUT /api/v1/tasks/household-list'),
    );
  });

  it('does not warn when a household list is designated', async () => {
    const warnSpy = vi.spyOn(console, 'warn');
    await bootstrap(); // Seed the household first
    // Bootstrap seeds an admin, so get that one
    const [adminRow] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    const admin = adminRow!;
    registerProvider(stubProvider());

    // Designate a household list
    await db.insert(todoListAllowlist).values({
      memberId: admin.id, provider: 'm365', listId: 'l1', listName: 'Household',
    });
    await setHouseholdList(admin.id, 'm365', 'l1');

    await warnIfNoHouseholdList();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when no providers are registered', async () => {
    const warnSpy = vi.spyOn(console, 'warn');

    await warnIfNoHouseholdList();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
