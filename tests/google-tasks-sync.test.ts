import { describe, it, expect, beforeEach } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { createFakeGoogle, runtimeForFakeGoogle, type FakeGoogle } from './fake-google.js';
import { GoogleTaskProvider } from '../src/google/task-provider.js';
import { setAllowlist } from '../src/modules/tasks/store.js';
import { TaskProviderError } from '../src/modules/tasks/providers/types.js';
import type { GoogleRuntime } from '../src/google/runtime.js';

let fake: FakeGoogle;
let rt: GoogleRuntime;
const provider = () => new GoogleTaskProvider(rt, async () => 'Europe/Berlin');

beforeEach(() => {
  fake = createFakeGoogle();
  rt = runtimeForFakeGoogle(fake);
});

async function connectedMemberWithList() {
  const { adult } = await seedTestHousehold();
  await rt.store.upsertConnection({
    memberId: adult.user.id, accountLabel: 'a@gmail.test', refreshToken: 'r', scopes: '',
  });
  await setAllowlist(adult.user.id, 'google', [{ id: 'list-1', name: 'Haushalt' }]);
  return { memberId: adult.user.id, feedKey: `google:todo:member:${adult.user.id}:list-1` };
}

describe('GoogleTaskProvider.listAvailableLists', () => {
  it('reports the member\'s task lists', async () => {
    const { memberId } = await connectedMemberWithList();
    fake.setTaskLists([{ id: 'list-1', title: 'Haushalt' }, { id: 'list-2', title: 'Einkauf' }]);
    expect(await provider().listAvailableLists(memberId)).toEqual([
      { id: 'list-1', name: 'Haushalt' }, { id: 'list-2', name: 'Einkauf' },
    ]);
  });

  it('wraps a failure in a classified TaskProviderError', async () => {
    const { child } = await seedTestHousehold();
    const e = await provider().listAvailableLists(child.user.id).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(TaskProviderError);
    expect((e as TaskProviderError).reason).toBe('no_connection');
  });
});

describe('GoogleTaskProvider.pullChanges', () => {
  it('always reports a full snapshot and asks for completed AND hidden tasks', async () => {
    const { memberId, feedKey } = await connectedMemberWithList();
    fake.setTasks('list-1', [{ id: 't-1', title: 'Müll rausbringen' }]);

    // A stale token is passed in deliberately: this provider must ignore it.
    const out = await provider().pullChanges(feedKey, 'a-stale-token');

    expect(out.fullResync).toBe(true);
    expect(out.nextToken).toBeNull();
    expect(out.deletions).toEqual([]);
    expect(out.upserts).toEqual([{
      externalId: 't-1', title: 'Müll rausbringen', notes: null,
      dueAt: null, completedAt: null, status: 'open',
      listId: 'list-1', listName: 'Haushalt', memberId,
    }]);
    const call = fake.calls.find((c) => c.path.endsWith('/tasks'))!;
    // `showCompleted` defaults to true, but a completed task is also hidden,
    // and hidden items need `showHidden=true` — without BOTH, a completion
    // reads as a deletion to the reconciler.
    expect(call.query).toContain('showCompleted=true');
    expect(call.query).toContain('showHidden=true');
  });

  it('carries a completed task through as completed, NOT as a deletion', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.setTasks('list-1', [{
      id: 't-done', title: 'Erledigt', status: 'completed',
      completed: '2026-09-01T18:42:11.000Z', hidden: true,
    }]);

    const out = await provider().pullChanges(feedKey, null);
    expect(out.upserts).toHaveLength(1);
    expect(out.upserts[0]).toMatchObject({
      externalId: 't-done', status: 'completed',
      // A real RFC3339 instant: Google is better than To Do here, so it is
      // stored as-is rather than coarsened to a date.
      completedAt: '2026-09-01T18:42:11.000Z',
    });
    expect(out.deletions).toEqual([]);
  });

  it('converts a date-only due value to household-local midnight', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.setTasks('list-1', [{ id: 't-due', title: 'Fällig', due: '2026-09-05T00:00:00.000Z' }]);
    const [task] = (await provider().pullChanges(feedKey, null)).upserts;
    // Berlin is UTC+2 in September.
    expect(task!.dueAt).toBe('2026-09-04T22:00:00.000Z');
  });

  it('never asks for tombstones, and ignores one if it arrives anyway', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.setTasks('list-1', [
      { id: 't-live', title: 'Lebt' },
      { id: 't-dead', title: 'Weg', deleted: true },
    ]);

    const out = await provider().pullChanges(feedKey, null);

    // The fake honours Google's showDeleted=false default, so the tombstone is
    // not delivered at all — deletion is detected by ABSENCE from the snapshot,
    // which is the whole point of the design.
    expect(out.upserts.map((t) => t.externalId)).toEqual(['t-live']);
    expect(fake.calls.find((c) => c.path.endsWith('/tasks'))!.query).not.toContain('showDeleted');
  });

  it('pages to exhaustion', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.tasksPageSize = 1;
    fake.setTasks('list-1', [{ id: 't-1', title: 'A' }, { id: 't-2', title: 'B' }, { id: 't-3', title: 'C' }]);
    const out = await provider().pullChanges(feedKey, null);
    expect(out.upserts.map((t) => t.externalId)).toEqual(['t-1', 't-2', 't-3']);
  });

  it('refuses a feed key with no allowlist row', async () => {
    const { memberId } = await connectedMemberWithList();
    await expect(
      provider().pullChanges(`google:todo:member:${memberId}:not-allowlisted`, null),
    ).rejects.toThrow(/Unknown Google task feed/);
  });
});

describe('GoogleTaskProvider write-back', () => {
  it('patches a completion with a real instant', async () => {
    const { feedKey } = await connectedMemberWithList();
    await provider().setCompleted(feedKey, 't-1', true);
    const call = fake.calls.find((c) => c.method === 'PATCH')!;
    expect(call.path).toBe('/tasks/v1/lists/list-1/tasks/t-1');
    expect(call.body).toMatchObject({ status: 'completed' });
    expect(typeof (call.body as { completed?: string }).completed).toBe('string');
  });

  it('clears the completion instant when re-opening a task', async () => {
    const { feedKey } = await connectedMemberWithList();
    await provider().setCompleted(feedKey, 't-1', false);
    const call = fake.calls.find((c) => c.method === 'PATCH')!;
    expect(call.body).toEqual({ status: 'needsAction', completed: null });
  });

  it('creates a task with a date-only due value', async () => {
    const { memberId, feedKey } = await connectedMemberWithList();
    const created = await provider().createTask(feedKey, {
      title: 'Neue Aufgabe', notes: 'Kontext', dueAt: '2026-09-05T22:00:00.000Z',
    });
    // `getAccessToken` fires its own POST /token refresh call before this one,
    // so disambiguate by path rather than matching the first POST.
    const call = fake.calls.find((c) => c.method === 'POST' && c.path.includes('/tasks/v1/lists'))!;
    // 2026-09-05T22:00Z is 2026-09-06 local in Berlin — the intended day.
    expect(call.body).toMatchObject({ title: 'Neue Aufgabe', notes: 'Kontext', due: '2026-09-06T00:00:00.000Z' });
    expect(created).toMatchObject({ title: 'Neue Aufgabe', memberId, listId: 'list-1', status: 'open' });
  });

  it('wraps a write failure in a classified TaskProviderError', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.failRefresh = true;
    rt.oauth.clearCache();
    const e = await provider().setCompleted(feedKey, 't-1', true).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(TaskProviderError);
    expect((e as TaskProviderError).reason).toBe('needs_reauth');
  });
});
