import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { taskMirror, todoListAllowlist } from '../src/modules/tasks/schema.js';
import { setTaskProvider } from '../src/modules/tasks/provider.js';
import { TaskProviderError, type TaskProvider, type MirroredTask } from '../src/modules/tasks/providers/types.js';
import * as store from '../src/modules/weorc/store.js';
import { ethelAssets } from '../src/modules/ethel/schema.js';
import { runWeorcTick, occurrenceMarker } from '../src/modules/weorc/engine.js';
import { householdToday } from '../src/modules/weorc/dates.js';
import { seedTestHousehold } from './helpers.js';

function provider(createTask: TaskProvider['createTask']): TaskProvider {
  return {
    source: 'm365',
    async listAvailableLists() { return [{ id: 'list-1', name: 'Household' }]; },
    async pullChanges() { return { upserts: [], deletions: [], nextToken: null, fullResync: false }; },
    async setCompleted() { /* not used here */ },
    createTask,
  };
}

async function allowlistedMember() {
  const { adult } = await seedTestHousehold();
  await db.insert(todoListAllowlist).values({ memberId: adult.user.id, listId: 'list-1', listName: 'Household' });
  return adult.user.id;
}

describe('the project pass', () => {
  beforeEach(() => setTaskProvider(null));

  it('projects an open occurrence and stores the STABLE link', async () => {
    const memberId = await allowlistedMember();
    const today = await householdToday();
    const seen: Array<{ title: string; notes?: string | null; dueAt?: string | null }> = [];
    setTaskProvider(provider(async (feedKey, input): Promise<MirroredTask> => {
      seen.push(input);
      return {
        externalId: 'ext-1', title: input.title, notes: input.notes ?? null,
        dueAt: input.dueAt ?? null, completedAt: null, status: 'open',
        listId: 'list-1', listName: 'Household', memberId,
      };
    }), 'Household');

    const [asset] = await db.insert(ethelAssets).values({ name: 'Boiler' }).returning();
    const r = await store.createRoutine({
      name: 'Service the boiler', mode: 'fixed', intervalUnit: 'month', intervalCount: 12,
      anchorDate: today, anchorAssetId: asset!.id, notes: 'Book the plumber',
    });

    const result = await runWeorcTick();
    expect(result.projected).toBe(1);

    const open = await store.getOpenOccurrence(r.id);
    expect(open!.taskExternalId).toBe('ext-1');
    expect(open!.taskFeedKey).toBe(`m365:todo:member:${memberId}:list-1`);
    expect(open!.projectionError).toBeNull();

    expect(seen[0]!.title).toBe('Service the boiler');
    expect(seen[0]!.notes).toContain('Boiler');
    expect(seen[0]!.notes).toContain('Book the plumber');
    expect(seen[0]!.notes).toContain(occurrenceMarker(open!.id));
  });

  it('RELINKS instead of creating a second task when the marker is already out there', async () => {
    const memberId = await allowlistedMember();
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    const occ = await store.insertOccurrence(r.id, today);
    // Simulate the crash window: Graph accepted the create and the sync
    // mirrored it, but Weorc died before storing the link.
    const feedKey = `todo:member:${memberId}:list-1`;
    await db.insert(taskMirror).values({
      source: 'm365', feedKey, externalId: 'ext-orphan', memberId,
      listId: 'list-1', title: 'Bins', notes: occurrenceMarker(occ.id), status: 'open',
    });

    let creates = 0;
    setTaskProvider(provider(async () => { creates += 1; throw new Error('must not create'); }), 'Household');

    const result = await runWeorcTick();
    expect(creates).toBe(0);
    expect(result.projected).toBe(1);
    expect((await store.getOccurrence(occ.id))!.taskExternalId).toBe('ext-orphan');
  });

  it('records a CLASSIFIED reason on failure, leaves the occurrence due, and retries next tick', async () => {
    await allowlistedMember();
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    setTaskProvider(provider(async () => { throw new TaskProviderError('needs_reauth'); }), 'Household');

    const result = await runWeorcTick();
    expect(result.projected).toBe(0);
    expect(result.projectionFailures).toBe(1);

    const open = await store.getOpenOccurrence(r.id);
    expect(open!.status).toBe('due');
    expect(open!.projectionError).toBe('needs_reauth');
    expect(open!.taskExternalId).toBeNull();
  });

  it('one dead feed does not stop the pass', async () => {
    await allowlistedMember();
    const today = await householdToday();
    await store.createRoutine({ name: 'A', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today });
    await store.createRoutine({ name: 'B', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today });

    let n = 0;
    setTaskProvider(provider(async (feedKey, input): Promise<MirroredTask> => {
      n += 1;
      if (n === 1) throw new TaskProviderError('graph_500');
      return {
        externalId: 'ext-ok', title: input.title, notes: input.notes ?? null, dueAt: null,
        completedAt: null, status: 'open', listId: 'list-1', listName: 'Household',
        memberId: feedKey.split(':')[3]!,
      };
    }), 'Household');

    const result = await runWeorcTick();
    expect(result.projectionFailures).toBe(1);
    expect(result.projected).toBe(1);
  });
});
