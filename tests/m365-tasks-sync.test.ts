import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { taskMirror, todoListAllowlist } from '../src/modules/tasks/schema.js';
import * as tasks from '../src/modules/tasks/service.js';
import { tasksRouter } from '../src/modules/tasks/routes.js';
import { setTaskProvider } from '../src/modules/tasks/provider.js';
import { TaskProviderError, type TaskProvider } from '../src/modules/tasks/providers/types.js';
import { runTaskSync } from '../src/m365/task-sync.js';
import { runCalendarSync } from '../src/m365/calendar-sync.js';
import { GraphTaskProvider } from '../src/m365/task-provider.js';
import { feedKeys } from '../src/m365/feed-keys.js';
import { setM365Runtime, type M365Runtime } from '../src/m365/runtime.js';
import { createFakeGraph, runtimeForFakeGraph, fakeM365Config, type FakeGraph } from './fake-graph.js';
import { localDateOf } from '../src/lib/local-date.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

afterEach(() => {
  setM365Runtime(null);
  setTaskProvider(null);
});

/** Seed a household + a connected M365 connection for a given member. */
async function connect(rt: M365Runtime, memberId: string, upn = 'member@contoso.test') {
  await rt.store.upsertConnection({
    memberId, accountUpn: upn, refreshToken: 'refresh-initial', scopes: 'Tasks.ReadWrite offline_access',
  });
}

/** Directly allowlist a list for a member (bypasses the live-validation path). */
async function allow(memberId: string, listId: string, listName: string) {
  await db.insert(todoListAllowlist).values({ memberId, listId, listName });
}

async function mirrorRows(feedKey: string) {
  return db.select().from(taskMirror).where(eq(taskMirror.feedKey, feedKey));
}

function task(id: string, title: string, extra: Partial<Record<string, unknown>> = {}) {
  return { id, title, ...extra };
}

/** Wire a fake-Graph runtime + provider seam and return both. */
function wire(shared = fakeM365Config.sharedTodoList) {
  const fake = createFakeGraph();
  const rt = runtimeForFakeGraph(fake);
  setM365Runtime(rt);
  const provider = new GraphTaskProvider(rt);
  setTaskProvider(provider, shared);
  return { fake, rt, provider };
}

describe('m365 tasks — list discovery + allowlist', () => {
  it('discovers a member\'s lists and flags which are allowlisted', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    fake.setTodoLists([
      { id: 'L1', displayName: 'Groceries' },
      { id: 'L2', displayName: 'Household' },
    ]);

    let lists = await tasks.listAvailableLists(adult.user.id);
    expect(lists.map((l) => `${l.id}:${l.name}:${l.enabled}`).sort())
      .toEqual(['L1:Groceries:false', 'L2:Household:false']);

    await tasks.setAllowlist(adult.user.id, ['L1']);
    lists = await tasks.listAvailableLists(adult.user.id);
    expect(lists.find((l) => l.id === 'L1')!.enabled).toBe(true);
    expect(lists.find((l) => l.id === 'L2')!.enabled).toBe(false);
  });

  it('setAllowlist rejects a list the member cannot access', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    fake.setTodoLists([{ id: 'L1', displayName: 'Groceries' }]);
    await expect(tasks.setAllowlist(adult.user.id, ['L1', 'NOPE'])).rejects.toMatchObject({ reason: 'unknown_list' });
  });
});

describe('m365 tasks — sync', () => {
  it('syncs only allowlisted lists (gating)', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries'); // only L1 allowlisted
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk')] }] }]);
    fake.setTodoTasks('L2', [{ pages: [{ upserts: [task('t2', 'Secret')] }] }]);

    const results = await runTaskSync(rt);
    const l1Key = feedKeys.todoMember(adult.user.id, 'L1');
    expect(results.find((r) => r.feedKey === l1Key)!.status).toBe('ok');
    // L2 never enumerated (not allowlisted).
    expect(results.some((r) => r.feedKey === feedKeys.todoMember(adult.user.id, 'L2'))).toBe(false);
    expect((await mirrorRows(l1Key)).map((r) => r.externalId)).toEqual(['t1']);
    const all = await db.select().from(taskMirror);
    expect(all.every((r) => r.externalId !== 't2')).toBe(true);
  });

  it('applies a delta: add, update, and complete-from-outside', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries');
    const key = feedKeys.todoMember(adult.user.id, 'L1');

    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk')] }] }]);
    await runTaskSync(rt);
    expect((await mirrorRows(key))[0]!.status).toBe('open');

    fake.setTodoTasks('L1', [
      { pages: [{ upserts: [task('t1', 'Milk')] }] },
      { pages: [{ upserts: [
        task('t1', 'Milk (2%)', { status: 'completed', completedUtc: '2026-07-24T10:00:00.000Z' }),
        task('t2', 'Eggs'),
      ] }] },
    ]);
    await runTaskSync(rt);

    const rows = await mirrorRows(key);
    expect(rows.map((r) => r.externalId).sort()).toEqual(['t1', 't2']);
    const t1 = rows.find((r) => r.externalId === 't1')!;
    expect(t1.title).toBe('Milk (2%)');
    expect(t1.status).toBe('completed');
    expect(t1.completedAt).toBeTruthy();
  });

  it('handles a @removed deletion', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries');
    const key = feedKeys.todoMember(adult.user.id, 'L1');

    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk'), task('t2', 'Eggs')] }] }]);
    await runTaskSync(rt);
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk'), task('t2', 'Eggs')] }] }, { pages: [{ removed: ['t2'] }] }]);
    await runTaskSync(rt);

    expect((await mirrorRows(key)).map((r) => r.externalId)).toEqual(['t1']);
  });

  it('full re-syncs (replace) on a 410 Gone token', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries');
    const key = feedKeys.todoMember(adult.user.id, 'L1');

    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk'), task('t2', 'Eggs')] }] }]);
    await runTaskSync(rt);
    expect((await mirrorRows(key)).length).toBe(2);

    fake.setTodoTasks('L1', [
      { pages: [{ upserts: [task('t1', 'Milk only')] }] },
      { pages: [], gone: true },
    ]);
    await runTaskSync(rt);
    const rows = await mirrorRows(key);
    expect(rows.map((r) => r.externalId)).toEqual(['t1']);
    expect(rows[0]!.title).toBe('Milk only');
  });
});

describe('m365 tasks — write-back', () => {
  it('completes a task: PATCH is sent and the local mirror is updated', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries');
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk')] }] }]);
    await runTaskSync(rt);
    const [row] = await mirrorRows(feedKeys.todoMember(adult.user.id, 'L1'));

    const updated = await tasks.completeTask(row!.id, true);
    expect(updated!.status).toBe('completed');
    expect(updated!.completedAt).toBeTruthy();
    const patch = fake.calls.find((c) => c.method === 'PATCH' && c.path.includes('/todo/lists/L1/tasks/t1'));
    expect(patch).toBeTruthy();
  });

  it('creates a task into the shared list (resolution by name)', async () => {
    const { fake, rt } = wire(); // shared list name = 'Household'
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L2', 'Household'); // the shared list, allowlisted by the actor

    const created = await tasks.createTask({ title: 'Buy stamps', notes: 'first class', dueAt: null }, adult.user.id);
    expect(created.title).toBe('Buy stamps');
    expect(created.listId).toBe('L2');
    expect(created.memberId).toBe(adult.user.id);
    const post = fake.calls.find((c) => c.method === 'POST' && c.path.includes('/todo/lists/L2/tasks'));
    expect(post).toBeTruthy();
    // It is mirrored locally immediately.
    expect((await mirrorRows(feedKeys.todoMember(adult.user.id, 'L2'))).length).toBe(1);
  });

  it('creates into the shared list via a fallback member when the actor lacks it', async () => {
    const { fake, rt } = wire();
    const { adult, child } = await seedTestHousehold();
    await connect(rt, adult.user.id, 'adult@contoso.test');
    await connect(rt, child.user.id, 'child@contoso.test');
    // The actor (adult) has only a non-shared list; the child has the shared 'Household'.
    await allow(adult.user.id, 'L1', 'Groceries');
    await allow(child.user.id, 'L2', 'Household');

    const created = await tasks.createTask({ title: 'Trash night', dueAt: null }, adult.user.id);
    expect(created.memberId).toBe(child.user.id); // resolved through the member who has the list
    expect(created.listId).toBe('L2');
    const post = fake.calls.find((c) => c.method === 'POST' && c.path.includes('/todo/lists/L2/tasks'));
    expect(post).toBeTruthy();
  });

  it('errors (classified) when no member has the shared list', async () => {
    const { rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries'); // no 'Household' anywhere
    await expect(tasks.createTask({ title: 'x' }, adult.user.id))
      .rejects.toMatchObject({ reason: 'shared_list_unavailable' });
  });

  it('a dead (missing) connection yields a classified error and does NOT change local state', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries');
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk')] }] }]);
    await runTaskSync(rt);
    const [row] = await mirrorRows(feedKeys.todoMember(adult.user.id, 'L1'));

    // Simulate a dead connection: drop the row + the cached access token.
    await rt.store.deleteConnection(adult.user.id);
    rt.delegated.clearCache();

    await expect(tasks.completeTask(row!.id, true)).rejects.toMatchObject({ reason: 'no_connection' });
    // Local state untouched — not silently completed.
    const after = await mirrorRows(feedKeys.todoMember(adult.user.id, 'L1'));
    expect(after[0]!.status).toBe('open');
  });

  it('write paths return provider_unavailable when the integration is disabled', async () => {
    setTaskProvider(null); // no provider installed
    const { adult } = await seedTestHousehold();
    await expect(tasks.createTask({ title: 'x' }, adult.user.id))
      .rejects.toMatchObject({ reason: 'provider_unavailable' });
  });
});

describe('m365 tasks — To Do date semantics (dueDateTime/completedDateTime are calendar dates)', () => {
  const berlin = () => Promise.resolve('Europe/Berlin');
  const newYork = () => Promise.resolve('America/New_York');

  /** Wire the fake + runtime and build a provider with an injected zone resolver. */
  function wireZoned(resolve: () => Promise<string>) {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    setM365Runtime(rt);
    return { fake, rt, provider: new GraphTaskProvider(rt, resolve) };
  }

  it('inbound due date authored in Berlin lands on the intended Berlin day', async () => {
    const { fake, rt, provider } = wireZoned(berlin);
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    // Graph stores due "Jul 25" authored in UTC+2 as the UTC instant Jul 24 22:00.
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [
      task('t1', 'Milk', { dueUtc: '2026-07-24T22:00:00.0000000' }),
    ] }] }]);

    const pull = await provider.pullChanges(feedKeys.todoMember(adult.user.id, 'L1'), null);
    const due = pull.upserts[0]!.dueAt!;
    expect(new Date(due).toISOString()).toBe('2026-07-24T22:00:00.000Z'); // Berlin midnight of Jul 25
    expect(localDateOf(due, 'Europe/Berlin')).toBe('2026-07-25');
  });

  it('inbound midnight-UTC stamp is a date-only value: its raw date part wins', async () => {
    const { fake, rt, provider } = wireZoned(berlin);
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    // The Graph completion known-issue stamp: midnight UTC of the current UTC date.
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [
      task('t1', 'Done', { status: 'completed', completedUtc: '2026-07-24T00:00:00.0000000' }),
    ] }] }]);

    const pull = await provider.pullChanges(feedKeys.todoMember(adult.user.id, 'L1'), null);
    const completedAt = pull.upserts[0]!.completedAt!;
    expect(localDateOf(completedAt, 'Europe/Berlin')).toBe('2026-07-24');
    expect(new Date(completedAt).toISOString()).toBe('2026-07-23T22:00:00.000Z'); // Berlin midnight of Jul 24
  });

  it('negative offset (America/New_York): NY-authored due date and a midnight-UTC stamp both land on Jul 25', async () => {
    const { fake, rt, provider } = wireZoned(newYork);
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [
      // Due "Jul 25" authored in NY (UTC-4) → stored as Jul 25 04:00 UTC.
      task('t1', 'NY-authored', { dueUtc: '2026-07-25T04:00:00.0000000' }),
      // A midnight-UTC date-only stamp for Jul 25: must NOT shift back to Jul 24.
      task('t2', 'UTC-stamped', { dueUtc: '2026-07-25T00:00:00.0000000' }),
    ] }] }]);

    const pull = await provider.pullChanges(feedKeys.todoMember(adult.user.id, 'L1'), null);
    const byId = new Map(pull.upserts.map((u) => [u.externalId, u]));
    expect(localDateOf(byId.get('t1')!.dueAt!, 'America/New_York')).toBe('2026-07-25');
    expect(localDateOf(byId.get('t2')!.dueAt!, 'America/New_York')).toBe('2026-07-25');
  });

  it('setCompleted(true) PATCHes an explicit completedDateTime at household-local today', async () => {
    const { fake, rt, provider } = wireZoned(berlin);
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);

    await provider.setCompleted(feedKeys.todoMember(adult.user.id, 'L1'), 't1', true);

    const patch = fake.calls.find((c) => c.method === 'PATCH' && c.path.includes('/todo/lists/L1/tasks/t1'));
    expect(patch).toBeTruthy();
    const today = localDateOf(new Date(), 'Europe/Berlin');
    expect(patch!.body).toMatchObject({
      status: 'completed',
      completedDateTime: { dateTime: `${today}T00:00:00`, timeZone: 'Europe/Berlin' },
    });
  });

  it('setCompleted(false) clears completedDateTime', async () => {
    const { fake, rt, provider } = wireZoned(berlin);
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);

    await provider.setCompleted(feedKeys.todoMember(adult.user.id, 'L1'), 't1', false);

    const patch = fake.calls.find((c) => c.method === 'PATCH' && c.path.includes('/todo/lists/L1/tasks/t1'));
    expect(patch!.body).toMatchObject({ status: 'notStarted', completedDateTime: null });
  });

  it('createTask sends the due date as household-local midnight + zone, not a UTC instant', async () => {
    const { fake, rt, provider } = wireZoned(berlin);
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);

    // 2026-08-01T22:00Z IS Aug 2 in Berlin.
    await provider.createTask(feedKeys.todoMember(adult.user.id, 'L1'), {
      title: 'Buy stamps', dueAt: '2026-08-01T22:00:00.000Z',
    });

    const post = fake.calls.find((c) => c.method === 'POST' && c.path.includes('/todo/lists/L1/tasks'));
    expect(post).toBeTruthy();
    expect(post!.body).toMatchObject({
      dueDateTime: { dateTime: '2026-08-02T00:00:00', timeZone: 'Europe/Berlin' },
    });
  });
});

describe('m365 tasks — scheduler isolation (mixed calendar + todo feeds)', () => {
  it('isolates a failing todo feed from other todo feeds and the calendar', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id, 'adult@contoso.test');
    await allow(adult.user.id, 'L1', 'Groceries'); // will fail
    await allow(adult.user.id, 'L2', 'Household');  // will succeed
    fake.failTodoDelta.add('L1');
    fake.setTodoTasks('L2', [{ pages: [{ upserts: [task('t2', 'Eggs')] }] }]);
    fake.setCalendar('me', [{ pages: [{ upserts: [
      { id: 'e1', subject: 'Dentist', startUtc: '2026-08-01T09:00:00.000Z', endUtc: '2026-08-01T10:00:00.000Z' },
    ] }] }]);

    const calendar = await runCalendarSync(rt);
    const todo = await runTaskSync(rt);

    const l1 = todo.find((r) => r.feedKey === feedKeys.todoMember(adult.user.id, 'L1'))!;
    const l2 = todo.find((r) => r.feedKey === feedKeys.todoMember(adult.user.id, 'L2'))!;
    expect(l1.status).toBe('error');
    expect(l1.reason).toBe('graph_500');
    expect(l2.status).toBe('ok'); // sibling todo feed unaffected
    expect(calendar.find((r) => r.feedKey === feedKeys.calendarMember(adult.user.id))!.status).toBe('ok');

    const state = await rt.store.getSyncState(feedKeys.todoMember(adult.user.id, 'L1'));
    expect(state?.lastError).toBe('graph_500');
    expect(state?.consecutiveFailures).toBe(1);
  });
});

describe('m365 tasks — REST', () => {
  function app() {
    const a = new Hono();
    a.route('/api/v1/tasks', tasksRouter);
    return a;
  }

  it('lists mirrored tasks with filters and a child can complete + create', async () => {
    const { fake, rt } = wire();
    const { adult, child } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L2', 'Household');
    fake.setTodoTasks('L2', [{ pages: [{ upserts: [
      task('t1', 'Milk'),
      task('t2', 'Done thing', { status: 'completed', completedUtc: '2026-07-20T08:00:00.000Z' }),
    ] }] }]);
    await runTaskSync(rt);

    // Read: any member; filter open only.
    const openRes = await app().request('/api/v1/tasks?status=open', { headers: authHeaders(child.jwt) });
    expect(openRes.status).toBe(200);
    const openBody = await openRes.json() as { data: Array<{ externalId: string }> };
    expect(openBody.data.map((t) => t.externalId)).toEqual(['t1']);

    // A child completes a task (household task list — children allowed).
    const [row] = await mirrorRows(feedKeys.todoMember(adult.user.id, 'L2'));
    const done = await app().request(`/api/v1/tasks/${row!.id}/complete`, {
      method: 'POST', headers: authHeaders(child.jwt), body: JSON.stringify({ completed: true }),
    });
    expect(done.status).toBe(200);

    // A child creates into the shared list.
    const create = await app().request('/api/v1/tasks', {
      method: 'POST', headers: authHeaders(child.jwt), body: JSON.stringify({ title: 'Homework folder' }),
    });
    expect(create.status).toBe(201);
    const post = fake.calls.find((c) => c.method === 'POST' && c.path.includes('/todo/lists/L2/tasks'));
    expect(post).toBeTruthy();
  });

  it('a dead connection surfaces as a 409 over REST', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries');
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk')] }] }]);
    await runTaskSync(rt);
    const [row] = await mirrorRows(feedKeys.todoMember(adult.user.id, 'L1'));
    await rt.store.deleteConnection(adult.user.id);
    rt.delegated.clearCache();

    const res = await app().request(`/api/v1/tasks/${row!.id}/complete`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ completed: true }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('NO_CONNECTION');
  });

  /** A provider stub whose write paths throw a scripted classified error. */
  function failingProvider(reason: string): TaskProvider {
    return {
      source: 'm365',
      async listAvailableLists() { return []; },
      async pullChanges() { throw new Error('unused in this test'); },
      async setCompleted() { throw new TaskProviderError(reason, `boom (${reason})`); },
      async createTask() { throw new Error('unused in this test'); },
    };
  }

  it('a Graph 5xx during write-back surfaces as 502, not 500', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries');
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk')] }] }]);
    await runTaskSync(rt);
    const [row] = await mirrorRows(feedKeys.todoMember(adult.user.id, 'L1'));

    setTaskProvider(failingProvider('graph_503'));
    const res = await app().request(`/api/v1/tasks/${row!.id}/complete`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ completed: true }),
    });
    expect(res.status).toBe(502);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('GRAPH_503');
  });

  it('a network failure during write-back surfaces as 503, not 500', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries');
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk')] }] }]);
    await runTaskSync(rt);
    const [row] = await mirrorRows(feedKeys.todoMember(adult.user.id, 'L1'));

    setTaskProvider(failingProvider('network_error'));
    const res = await app().request(`/api/v1/tasks/${row!.id}/complete`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ completed: true }),
    });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('NETWORK_ERROR');
  });

  it('a non-transient Graph error still maps to 500 (unchanged)', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    await allow(adult.user.id, 'L1', 'Groceries');
    fake.setTodoTasks('L1', [{ pages: [{ upserts: [task('t1', 'Milk')] }] }]);
    await runTaskSync(rt);
    const [row] = await mirrorRows(feedKeys.todoMember(adult.user.id, 'L1'));

    setTaskProvider(failingProvider('graph_404'));
    const res = await app().request(`/api/v1/tasks/${row!.id}/complete`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ completed: true }),
    });
    expect(res.status).toBe(500);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('GRAPH_404');
  });

  it('GET/PUT allowlist round-trips for the acting member', async () => {
    const { fake, rt } = wire();
    const { adult } = await seedTestHousehold();
    await connect(rt, adult.user.id);
    fake.setTodoLists([{ id: 'L1', displayName: 'Groceries' }, { id: 'L2', displayName: 'Household' }]);

    const put = await app().request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt), body: JSON.stringify({ listIds: ['L2'] }),
    });
    expect(put.status).toBe(200);
    const get = await app().request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    const body = await get.json() as { data: Array<{ listId: string }> };
    expect(body.data.map((r) => r.listId)).toEqual(['L2']);
  });
});
