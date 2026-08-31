import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { db } from '../src/db/index.js';
import { todoListAllowlist } from '../src/modules/tasks/schema.js';
import { tasksRouter } from '../src/modules/tasks/routes.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

/** A bare app with just the tasks router mounted — same construction as
 *  `tests/m365-tasks-sync.test.ts`'s `app()`. */
function app() {
  const a = new Hono();
  a.route('/api/v1/tasks', tasksRouter);
  return a;
}

async function allowlist(memberId: string, provider: string, listId: string, name: string) {
  await db.insert(todoListAllowlist).values({ memberId, provider, listId, listName: name });
}

describe('PUT /api/v1/tasks/household-list', () => {
  it('an adult can designate an allowlisted list', async () => {
    const { adult } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Household');

    const res = await app().request('/api/v1/tasks/household-list', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ provider: 'm365', listId: 'l1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { provider: string; memberId: string; listId: string } };
    expect(body.data).toMatchObject({ provider: 'm365', memberId: adult.user.id, listId: 'l1' });
  });

  it('an admin can designate an allowlisted list', async () => {
    const { admin } = await seedTestHousehold();
    await allowlist(admin.user.id, 'google', 'l2', 'Household');

    const res = await app().request('/api/v1/tasks/household-list', {
      method: 'PUT', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ provider: 'google', listId: 'l2' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { provider: string; listId: string } };
    expect(body.data).toMatchObject({ provider: 'google', listId: 'l2' });
  });

  it('a child cannot designate the household list (403)', async () => {
    const { child } = await seedTestHousehold();
    await allowlist(child.user.id, 'm365', 'l1', 'Household');

    const res = await app().request('/api/v1/tasks/household-list', {
      method: 'PUT', headers: authHeaders(child.jwt),
      body: JSON.stringify({ provider: 'm365', listId: 'l1' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('rejects a body missing provider (400)', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app().request('/api/v1/tasks/household-list', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ listId: 'l1' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty listId (400)', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app().request('/api/v1/tasks/household-list', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ provider: 'm365', listId: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('designating a list the member has not allowlisted maps to unknown_list (409)', async () => {
    const { adult } = await seedTestHousehold();
    // No allowlist row for 'l1' at all.
    const res = await app().request('/api/v1/tasks/household-list', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ provider: 'm365', listId: 'l1' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('UNKNOWN_LIST');
  });
});
