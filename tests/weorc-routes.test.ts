import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { ethelAssets, ethelPlaces } from '../src/modules/ethel/schema.js';
import { taskMirror } from '../src/modules/tasks/schema.js';
import { clearProviders } from '../src/integrations/registry.js';
import { TaskProviderError, type MirroredTask, type TaskProvider } from '../src/modules/tasks/providers/types.js';
import * as store from '../src/modules/weorc/store.js';
import { householdToday } from '../src/modules/weorc/dates.js';
import { addDays } from '../src/modules/weorc/recurrence.js';
import { seedTestHousehold, authHeaders, registerFakeTaskProvider } from './helpers.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

const app = createApp(ALL_MODULES);

const body = (over = {}) => JSON.stringify({
  name: 'Put the bins out', mode: 'fixed', intervalUnit: 'week',
  intervalCount: 1, anchorDate: '2026-09-01', ...over,
});

function provider(overrides: Partial<TaskProvider>): TaskProvider {
  return {
    source: 'm365',
    async listAvailableLists() { return []; },
    async pullChanges() { return { upserts: [], deletions: [], nextToken: null, fullResync: false }; },
    async setCompleted() { /* default no-op */ },
    async createTask(feedKey, input): Promise<MirroredTask> {
      return {
        externalId: 'ext-created',
        title: input.title,
        notes: input.notes ?? null,
        dueAt: input.dueAt ?? null,
        completedAt: null,
        status: 'open',
        listId: 'list-1',
        listName: 'Household',
        memberId: feedKey.split(':')[2]!,
      };
    },
    ...overrides,
  };
}

describe('weorc routes', () => {
  beforeEach(() => clearProviders());

  it('creates an UNANCHORED routine - the normal case', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/weorc/routines', {
      method: 'POST', headers: authHeaders(adult.jwt), body: body(),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.anchorAssetId).toBeNull();
  });

  it('refuses two anchors with ANCHOR_CONFLICT', async () => {
    const { adult } = await seedTestHousehold();
    const [a] = await db.insert(ethelAssets).values({ name: 'Boiler' }).returning();
    const [p] = await db.insert(ethelPlaces).values({ name: 'Utility', kind: 'room' }).returning();
    const res = await app.request('/api/v1/weorc/routines', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: body({ anchorAssetId: a!.id, anchorPlaceId: p!.id }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('ANCHOR_CONFLICT');
  });

  it('refuses an unknown anchor with ASSET_NOT_FOUND', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/weorc/routines', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: body({ anchorAssetId: '11111111-1111-1111-1111-111111111111' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('ASSET_NOT_FOUND');
  });

  it('refuses a child (role gate), allows an adult', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/weorc/routines', {
      method: 'POST', headers: authHeaders(child.jwt), body: body(),
    });
    expect(res.status).toBe(403);
  });

  it('lists routines with the computed next due date', async () => {
    const { adult } = await seedTestHousehold();
    const today = await householdToday();
    await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    const res = await app.request('/api/v1/weorc/routines', { headers: authHeaders(adult.jwt) });
    const json = await res.json();
    expect(json.meta.total).toBe(1);
    expect(json.data[0].nextDueOn).toBe(today);
    expect(json.data[0].openOccurrence).toBeNull();
  });

  it('refuses to DELETE a routine with history, and says why', async () => {
    const { adult } = await seedTestHousehold();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: '2026-09-01',
    });
    const occ = await store.insertOccurrence(r.id, '2026-09-01');
    await store.terminateOccurrence(occ.id, 'skipped', null, null, null);
    const res = await app.request(`/api/v1/weorc/routines/${r.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('ROUTINE_HAS_HISTORY');
  });

  it('DELETEs a routine that never ran', async () => {
    const { adult } = await seedTestHousehold();
    const r = await store.createRoutine({
      name: 'Oops', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: '2026-09-01',
    });
    const res = await app.request(`/api/v1/weorc/routines/${r.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(200);
  });

  it('completes an occurrence and defers the successor outside the lead horizon', async () => {
    const { adult } = await seedTestHousehold();
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    const occ = await store.insertOccurrence(r.id, today);
    const res = await app.request(`/api/v1/weorc/occurrences/${occ.id}/complete`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ note: 'two bags' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.occurrence.status).toBe('completed');
    expect(json.data.occurrence.completedByMemberId).toBe(adult.user.id);
    expect(json.data.next).toBeNull();
    expect((await serviceDetailNextDue(r.id, adult.jwt))).toBe(addDays(today, 7));
    // No provider is installed: nothing was projected and that is not a failure.
    expect(json.data.projection).toEqual({ ok: false });
  });

  it('completes an occurrence and returns the admitted successor at the lead boundary', async () => {
    const { adult } = await seedTestHousehold();
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1,
      anchorDate: today, leadDays: 7,
    });
    const occ = await store.insertOccurrence(r.id, today);
    const res = await app.request(`/api/v1/weorc/occurrences/${occ.id}/complete`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ note: 'two bags' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.next.dueOn).toBe(addDays(today, 7));
    expect(json.data.projection).toEqual({ ok: false });
  });

  it('keeps completion local when projected task completion fails', async () => {
    const { adult } = await seedTestHousehold();
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    const occ = await store.insertOccurrence(r.id, today);
    await store.setProjection(occ.id, 'todo:member:x:list-1', 'ext-1');
    // completeProjectedTask (Task 11) now resolves the provider from the
    // MIRROR ROW's source, so one must exist for the feed ref above.
    await db.insert(taskMirror).values({
      source: 'm365', feedKey: 'todo:member:x:list-1', externalId: 'ext-1',
      memberId: adult.user.id, listId: 'list-1', title: 'Bins', status: 'open',
    });
    registerFakeTaskProvider('m365', provider({
      async setCompleted() { throw new TaskProviderError('network_error'); },
    }));

    const res = await app.request(`/api/v1/weorc/occurrences/${occ.id}/complete`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.occurrence.status).toBe('completed');
    expect(json.data.projection).toEqual({ ok: false, reason: 'network_error' });
    expect((await store.getOccurrence(occ.id))!.status).toBe('completed');
  });

  it('refuses to complete an already-terminal occurrence', async () => {
    const { adult } = await seedTestHousehold();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: '2026-09-01',
    });
    const occ = await store.insertOccurrence(r.id, '2026-09-01');
    await store.terminateOccurrence(occ.id, 'skipped', null, null, null);
    const res = await app.request(`/api/v1/weorc/occurrences/${occ.id}/complete`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('ALREADY_TERMINAL');
  });

  it('skips WITHOUT claiming it was done', async () => {
    const { adult } = await seedTestHousehold();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: '2026-09-01',
    });
    const occ = await store.insertOccurrence(r.id, '2026-09-01');
    const res = await app.request(`/api/v1/weorc/occurrences/${occ.id}/skip`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ note: 'away' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.occurrence.status).toBe('skipped');
    expect(json.data.occurrence.completedAt).toBeNull();
  });

  it('leaves a PROJECTED open occurrence alone when the routine is edited', async () => {
    const { adult } = await seedTestHousehold();
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    const occ = await store.insertOccurrence(r.id, today);
    await store.setProjection(occ.id, 'todo:member:x:list-1', 'ext-1');

    const res = await app.request(`/api/v1/weorc/routines/${r.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ intervalCount: 2 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.openOccurrenceUnchanged).toBe(true);
    // TaskProvider has no update method, so silently moving dueOn here would
    // leave a To Do task showing the old date with nothing to explain it.
    expect((await store.getOccurrence(occ.id))!.dueOn).toBe(today);
  });

  it('DOES move an UNPROJECTED open occurrence when the routine is edited', async () => {
    const { adult } = await seedTestHousehold();
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'from_completion', intervalUnit: 'day', intervalCount: 1, anchorDate: today,
    });
    await store.insertOccurrence(r.id, today);
    const res = await app.request(`/api/v1/weorc/routines/${r.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ anchorDate: addDays(today, 1) }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.openOccurrenceUnchanged).toBe(false);
    expect((await store.getOpenOccurrence(r.id))!.dueOn).toBe(addDays(today, 1));
  });

  it('runs a tick on demand', async () => {
    const { adult } = await seedTestHousehold();
    const today = await householdToday();
    await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    const res = await app.request('/api/v1/weorc/run', {
      method: 'POST', headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.materialised).toBe(1);
  });

  it('requires auth', async () => {
    const res = await app.request('/api/v1/weorc/routines');
    expect(res.status).toBe(401);
  });
});

async function serviceDetailNextDue(routineId: string, jwt: string): Promise<string> {
  const res = await app.request(`/api/v1/weorc/routines/${routineId}`, {
    headers: authHeaders(jwt),
  });
  const json = await res.json();
  return json.data.nextDueOn;
}
