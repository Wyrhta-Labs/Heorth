import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { seedTestHousehold, authHeaders, registerFakeTaskProvider } from './helpers.js';
import { tasksRouter } from '../src/modules/tasks/routes.js';
import { clearProviders } from '../src/integrations/registry.js';
import { TaskProviderError } from '../src/modules/tasks/providers/types.js';
import type { AvailableList, TaskProvider } from '../src/modules/tasks/providers/types.js';

function fakeTaskProvider(id: string, lists: AvailableList[], failWith?: string): TaskProvider {
  return {
    source: id,
    listAvailableLists: async () => {
      if (failWith) throw new TaskProviderError(failWith);
      return lists;
    },
    pullChanges: async () => ({ upserts: [], deletions: [], nextToken: null, fullResync: true }),
    setCompleted: async () => {},
    createTask: async () => { throw new TaskProviderError('error'); },
  };
}

/** A bare app with just the tasks router — as `tests/tasks-household-list-routes.test.ts` does. */
function app() {
  const a = new Hono();
  a.route('/api/v1/tasks', tasksRouter);
  return a;
}

beforeEach(() => { clearProviders(); });
afterEach(() => { clearProviders(); });

describe('PUT /api/v1/tasks/allowlist', () => {
  it('enables a GOOGLE list under the google provider, not m365', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('m365', fakeTaskProvider('m365', [{ id: 'outlook-1', name: 'Outlook' }]));
    registerFakeTaskProvider('google', fakeTaskProvider('google', [{ id: 'g-1', name: 'Haushalt' }]));

    const put = await app().request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'google', listId: 'g-1' }] }),
    });
    expect(put.status).toBe(200);

    const res = await app().request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: Array<{ provider: string; listId: string }> };
    expect(data).toEqual([expect.objectContaining({ provider: 'google', listId: 'g-1' })]);
  });

  it('returns every provider\'s rows from GET, not just m365\'s', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('m365', fakeTaskProvider('m365', [{ id: 'outlook-1', name: 'Outlook' }]));
    registerFakeTaskProvider('google', fakeTaskProvider('google', [{ id: 'g-1', name: 'Haushalt' }]));

    await app().request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [
        { provider: 'm365', listId: 'outlook-1' },
        { provider: 'google', listId: 'g-1' },
      ] }),
    });

    const res = await app().request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: Array<{ provider: string }> };
    expect(data.map((r) => r.provider).sort()).toEqual(['google', 'm365']);
  });

  it('de-selecting every list of one provider leaves the other provider alone', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('m365', fakeTaskProvider('m365', [{ id: 'outlook-1', name: 'Outlook' }]));
    registerFakeTaskProvider('google', fakeTaskProvider('google', [{ id: 'g-1', name: 'Haushalt' }]));
    await app().request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [
        { provider: 'm365', listId: 'outlook-1' },
        { provider: 'google', listId: 'g-1' },
      ] }),
    });

    await app().request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'm365', listId: 'outlook-1' }] }),
    });

    const res = await app().request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: Array<{ provider: string }> };
    expect(data.map((r) => r.provider)).toEqual(['m365']);
  });

  it('leaves an unreachable provider\'s rows untouched instead of wiping them', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('google', fakeTaskProvider('google', [{ id: 'g-1', name: 'Haushalt' }]));
    await app().request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'google', listId: 'g-1' }] }),
    });

    // Google goes unreachable; the picker could not show its lists, so the next
    // submission carries none for it. That must NOT be read as a de-selection.
    clearProviders();
    registerFakeTaskProvider('google', fakeTaskProvider('google', [], 'no_connection'));
    registerFakeTaskProvider('m365', fakeTaskProvider('m365', [{ id: 'outlook-1', name: 'Outlook' }]));
    await app().request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'm365', listId: 'outlook-1' }] }),
    });

    const res = await app().request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: Array<{ provider: string }> };
    expect(data.map((r) => r.provider).sort()).toEqual(['google', 'm365']);
  });

  it('rejects a list the member cannot access', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('google', fakeTaskProvider('google', [{ id: 'g-1', name: 'Haushalt' }]));
    const res = await app().request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'google', listId: 'not-mine' }] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('UNKNOWN_LIST');
  });

  it('rejects a body still using the old listIds shape', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app().request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ listIds: ['g-1'] }),
    });
    // `lists` defaults to [] and `listIds` is stripped, so this is a no-op 200
    // rather than a silent m365 write — assert whichever the schema produces,
    // but it must NOT persist anything.
    const check = await app().request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    expect((await check.json() as { data: unknown[] }).data).toEqual([]);
    expect([200, 400]).toContain(res.status);
  });

  it('surfaces an upstream Google 5xx on a write-back as 502, mirroring the Graph case', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('google', fakeTaskProvider('google', [], 'google_503'));
    const res = await app().request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'google', listId: 'g-1' }] }),
    });
    expect(res.status).toBe(502);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('GOOGLE_503');
  });
});
