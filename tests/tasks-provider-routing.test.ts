import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../src/db/index.js';
import { taskMirror } from '../src/modules/tasks/schema.js';
import { clearProviders, registerProvider, getTaskProviderFor } from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';
import * as service from '../src/modules/tasks/service.js';
import { TaskProviderError } from '../src/modules/tasks/providers/types.js';
import { seedTestHousehold } from './helpers.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';
import { setM365Runtime } from '../src/m365/runtime.js';
import { createFakeGraph, runtimeForFakeGraph, fakeM365Config } from './fake-graph.js';
import { config, type M365Config } from '../src/config/env.js';

function recordingProvider(id: string, calls: string[]) {
  return {
    id,
    store: new IntegrationStore(id),
    classifyError: () => 'error',
    fullResyncIntervalMs: 1000,
    authorizeUrl: () => `https://${id}.test`,
    completeConnect: async () => ({ accountLabel: `a@${id}`, refreshToken: 'r', scopes: '' }),
    calendar: null,
    tasks: {
      source: id,
      listAvailableLists: async () => [],
      pullChanges: async () => ({ upserts: [], deletions: [], nextToken: null, fullResync: false }),
      setCompleted: async () => { calls.push(id); },
      createTask: async () => { throw new Error('not used'); },
    },
    runCalendarSync: async () => [],
    runTaskSync: async () => [],
  };
}

describe('task write-back routing', () => {
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    clearProviders();
    registerProvider(recordingProvider('m365', calls));
    registerProvider(recordingProvider('google', calls));
  });

  it('routes a completion to the provider named by the row source', async () => {
    const { adult } = await seedTestHousehold();
    const [row] = await db.insert(taskMirror).values({
      source: 'google',
      feedKey: 'google:todo:member:x:l1',
      externalId: 'g1',
      memberId: adult.user.id,
      listId: 'l1',
      title: 'Google task',
      status: 'open',
    }).returning();

    await service.completeTask(row!.id, true);
    expect(calls).toEqual(['google']);
  });

  it('routes an m365 row to m365 even with google registered later', async () => {
    const { adult } = await seedTestHousehold();
    const [row] = await db.insert(taskMirror).values({
      source: 'm365',
      feedKey: 'm365:todo:member:x:l1',
      externalId: 'm1',
      memberId: adult.user.id,
      listId: 'l1',
      title: 'Graph task',
      status: 'open',
    }).returning();

    await service.completeTask(row!.id, true);
    expect(calls).toEqual(['m365']);
  });

  it('reports provider_unavailable for an unregistered source', async () => {
    const { adult } = await seedTestHousehold();
    const [row] = await db.insert(taskMirror).values({
      source: 'caldav',
      feedKey: 'caldav:todo:member:x:l1',
      externalId: 'c1',
      memberId: adult.user.id,
      listId: 'l1',
      title: 'Orphan task',
      status: 'open',
    }).returning();

    await expect(service.completeTask(row!.id, true))
      .rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('does not let one unreachable provider hide another provider\'s lists', async () => {
    // The first provider's listAvailableLists already classifies its own
    // failure into a TaskProviderError('no_connection') — exactly what
    // GraphTaskProvider does. Discovery must recognize that reason directly
    // rather than re-classifying it through the SECOND provider's
    // classifyError (which only understands its own raw errors and would
    // fall through to 'error', rethrowing and killing discovery entirely).
    clearProviders();
    registerProvider({
      ...recordingProvider('m365', calls),
      tasks: {
        source: 'm365',
        listAvailableLists: async () => {
          throw new TaskProviderError('no_connection', 'not connected');
        },
        pullChanges: async () => ({ upserts: [], deletions: [], nextToken: null, fullResync: false }),
        setCompleted: async () => {},
        createTask: async () => { throw new Error('not used'); },
      },
    });
    registerProvider({
      ...recordingProvider('google', calls),
      tasks: {
        source: 'google',
        listAvailableLists: async () => [{ id: 'l1', name: 'Google List' }],
        pullChanges: async () => ({ upserts: [], deletions: [], nextToken: null, fullResync: false }),
        setCompleted: async () => {},
        createTask: async () => { throw new Error('not used'); },
      },
    });

    const { adult } = await seedTestHousehold();
    const lists = await service.listAvailableLists(adult.user.id);

    expect(lists).toEqual([
      { provider: 'google', id: 'l1', name: 'Google List', enabled: false },
    ]);
  });
});

describe('m365Module.register wiring', () => {
  // `isM365Enabled()` reads `config.m365`, which `tests/setup.ts` forces null
  // for the whole suite (blank M365_* env) so no real-tenant call can ever
  // enter the test process. That is exactly the gate this test needs past —
  // it wants `m365Module.register()` itself, gated on `isM365Enabled()`, to
  // run for real under `createApp(ALL_MODULES)`, not a hand-built bare app
  // that skips the gate (the deleted `tests/m365-routes.test.ts` used the
  // latter for its "enabled" tests, which is why it never had to do this).
  // `config` is `as const` only at the type level — not frozen at runtime —
  // so this casts past the readonly to flip the one field, and restores it.
  afterEach(() => {
    (config as unknown as { m365: M365Config | null }).m365 = null;
    setM365Runtime(null);
    clearProviders();
  });

  it('m365Module.register installs a usable task provider', async () => {
    // Registration happens as a side effect of building the app, exactly as it
    // does at boot — NOT by calling registerProvider() directly, which is what
    // every other test does and precisely why this gap existed.
    (config as unknown as { m365: M365Config | null }).m365 = fakeM365Config;
    clearProviders();
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    createApp(ALL_MODULES);

    const provider = getTaskProviderFor('m365');
    expect(provider).not.toBeNull();
    expect(provider!.source).toBe('m365');
  });
});
