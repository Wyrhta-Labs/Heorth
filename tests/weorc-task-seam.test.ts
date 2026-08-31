import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { taskMirror, todoListAllowlist } from '../src/modules/tasks/schema.js';
import { setHouseholdList } from '../src/modules/tasks/store.js';
import { clearProviders } from '../src/integrations/registry.js';
import * as tasks from '../src/modules/tasks/service.js';
import { TaskProviderError, type TaskProvider, type MirroredTask } from '../src/modules/tasks/providers/types.js';
import { seedTestHousehold, registerFakeTaskProvider } from './helpers.js';

/** Register `p` as the 'm365' provider. The household list is designated
 * separately, by the caller, via `setHouseholdList`. */
function wireProvider(p: TaskProvider): void {
  registerFakeTaskProvider('m365', p);
}

function fakeProvider(over: Partial<TaskProvider> = {}): TaskProvider & { created: unknown[]; completed: unknown[] } {
  const created: unknown[] = [];
  const completed: unknown[] = [];
  const provider = {
    source: 'm365',
    created,
    completed,
    async listAvailableLists() { return [{ id: 'list-1', name: 'Household' }]; },
    async pullChanges() { return { upserts: [], deletions: [], nextToken: null, fullResync: false }; },
    async setCompleted(feedKey: string, externalId: string, value: boolean) {
      completed.push({ feedKey, externalId, value });
    },
    async createTask(feedKey: string, input: { title: string; notes?: string | null; dueAt?: string | null }): Promise<MirroredTask> {
      created.push({ feedKey, input });
      return {
        externalId: `ext-${created.length}`,
        title: input.title,
        notes: input.notes ?? null,
        dueAt: input.dueAt ?? null,
        completedAt: null,
        status: 'open',
        listId: 'list-1',
        listName: 'Household',
        memberId: feedKey.split(':')[3]!,
      };
    },
    ...over,
  } as TaskProvider & { created: unknown[]; completed: unknown[] };
  return provider;
}

describe('the tasks seam Weorc needs', () => {
  beforeEach(() => { clearProviders(); });

  it('createHouseholdTask works with NO acting principal', async () => {
    const { adult } = await seedTestHousehold();
    await db.insert(todoListAllowlist).values({ memberId: adult.user.id, listId: 'list-1', listName: 'Household' });
    await setHouseholdList(adult.user.id, 'm365', 'list-1');
    const provider = fakeProvider();
    wireProvider(provider);

    const row = await tasks.createHouseholdTask({ title: 'Put the bins out' }, null);
    expect(row.title).toBe('Put the bins out');
    expect(provider.created).toHaveLength(1);
  });

  it('createHouseholdTask resolves through the DESIGNATED list, ignoring the (now decorative) preferMemberId', async () => {
    const { admin, adult } = await seedTestHousehold();
    await db.insert(todoListAllowlist).values([
      { memberId: admin.user.id, listId: 'list-1', listName: 'Household' },
      { memberId: adult.user.id, listId: 'list-2', listName: 'Household' },
    ]);
    await setHouseholdList(admin.user.id, 'm365', 'list-1');
    const provider = fakeProvider();
    wireProvider(provider);

    // preferMemberId names the adult, but the DESIGNATED list belongs to admin.
    const row = await tasks.createHouseholdTask({ title: 'Descale the kettle' }, adult.user.id);
    expect(row.memberId).toBe(admin.user.id);
  });

  it('createHouseholdTask throws a CLASSIFIED error when no provider is installed', async () => {
    await expect(tasks.createHouseholdTask({ title: 'Bins' }, null))
      .rejects.toBeInstanceOf(TaskProviderError);
  });

  it('completeProjectedTask keys on (feedKey, externalId), not the mirror uuid', async () => {
    const { adult } = await seedTestHousehold();
    const feedKey = `todo:member:${adult.user.id}:list-1`;
    await db.insert(taskMirror).values({
      source: 'm365',
      feedKey,
      externalId: 'ext-9',
      memberId: adult.user.id,
      listId: 'list-1',
      listName: 'Household',
      title: 'Bins',
      status: 'open',
    });
    const provider = fakeProvider();
    wireProvider(provider);

    await tasks.completeProjectedTask(feedKey, 'ext-9', true);
    expect(provider.completed).toEqual([{ feedKey, externalId: 'ext-9', value: true }]);
    const [row] = await db.select().from(taskMirror);
    expect(row!.status).toBe('completed');
  });

  // Task 11 changed this: `completeProjectedTask` used to call the provider
  // BEFORE looking for the mirror row, so it would complete upstream even with
  // no local row. It now requires the row first, because the row is what names
  // the provider (there is no source to resolve without it) — a missing row is
  // reported as `provider_unavailable` rather than guessed at.
  it('completeProjectedTask reports provider_unavailable when NO mirror row exists', async () => {
    const provider = fakeProvider();
    wireProvider(provider);
    await expect(tasks.completeProjectedTask('todo:member:x:list-1', 'ext-gone', true))
      .rejects.toMatchObject({ reason: 'provider_unavailable' });
    expect(provider.completed).toHaveLength(0);
  });

  it('finds a mirrored task by a notes marker', async () => {
    const { adult } = await seedTestHousehold();
    await db.insert(taskMirror).values({
      source: 'm365',
      feedKey: `todo:member:${adult.user.id}:list-1`,
      externalId: 'ext-3',
      memberId: adult.user.id,
      listId: 'list-1',
      title: 'Bins',
      notes: 'Kitchen\n\nweorc-occurrence:11111111-1111-1111-1111-111111111111',
      status: 'open',
    });
    const found = await tasks.findTaskByNotesMarker('weorc-occurrence:11111111-1111-1111-1111-111111111111');
    expect(found!.externalId).toBe('ext-3');
    expect(await tasks.findTaskByNotesMarker('weorc-occurrence:22222222-2222-2222-2222-222222222222')).toBeNull();
  });
});
