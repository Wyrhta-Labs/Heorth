// Follows tests/feoh-bills.test.ts post-Task-1 idiom: static imports of
// createApp/ALL_MODULES, seedTestHousehold()/authHeaders() from tests/helpers.js.
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

const app = createApp(ALL_MODULES);

async function stubTransactionId(adultUserId: string): Promise<string> {
  // postgres-js raw results are an ARRAY, not { rows }:
  const rows = (await db.execute(sql`
    INSERT INTO transactions (date, payee, amount, created_by)
    VALUES ('2026-08-01', 'stub', '10.00', ${adultUserId}::uuid) RETURNING id`)) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

describe('inventory routes', () => {
  it('creates, lists (with meta total), gets, patches, decommissions, and deletes an item', async () => {
    const { adult } = await seedTestHousehold();

    const created = await app.request('/api/v1/inventory/items', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ name: 'Bosch drill', category: 'tool', manufacturer: 'Bosch' }),
    });
    expect(created.status).toBe(201);
    const { data: item } = await created.json() as { data: { id: string; name: string } };
    expect(item.name).toBe('Bosch drill');

    const list = await app.request('/api/v1/inventory/items', { headers: authHeaders(adult.jwt) });
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: unknown[]; meta: { total: number } };
    expect(listBody.data.length).toBe(1);
    expect(listBody.meta.total).toBe(1);

    const got = await app.request(`/api/v1/inventory/items/${item.id}`, { headers: authHeaders(adult.jwt) });
    expect(got.status).toBe(200);
    const gotBody = await got.json() as { data: { name: string } };
    expect(gotBody.data.name).toBe('Bosch drill');

    const patched = await app.request(`/api/v1/inventory/items/${item.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Bosch hammer drill' }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = await patched.json() as { data: { name: string } };
    expect(patchedBody.data.name).toBe('Bosch hammer drill');

    const decommissioned = await app.request(`/api/v1/inventory/items/${item.id}/decommission`, {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-08-01', reason: 'broken' }),
    });
    expect(decommissioned.status).toBe(200);
    const decommissionedBody = await decommissioned.json() as { data: { decommissionReason: string } };
    expect(decommissionedBody.data.decommissionReason).toBe('broken');

    const secondDecommission = await app.request(`/api/v1/inventory/items/${item.id}/decommission`, {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-08-02', reason: 'broken' }),
    });
    expect(secondDecommission.status).toBe(409);
    const secondBody = await secondDecommission.json() as { error: { code: string } };
    expect(secondBody.error.code).toBe('ALREADY_DECOMMISSIONED');

    const deleted = await app.request(`/api/v1/inventory/items/${item.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(deleted.status).toBe(200);
  });

  it('blocks deleting an item with finance links with 409 HAS_FINANCE_LINKS', async () => {
    const { adult } = await seedTestHousehold();
    const created = await app.request('/api/v1/inventory/items', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'TV' }),
    });
    const { data: item } = await created.json() as { data: { id: string } };
    const txId = await stubTransactionId(adult.user.id);
    await db.execute(sql`
      INSERT INTO feoh_item_costs (transaction_id, item_id, kind)
      VALUES (${txId}::uuid, ${item.id}::uuid, 'repair')`);

    const deleted = await app.request(`/api/v1/inventory/items/${item.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(deleted.status).toBe(409);
    const deletedBody = await deleted.json() as { error: { code: string } };
    expect(deletedBody.error.code).toBe('HAS_FINANCE_LINKS');
  });

  it('rejects a child-role create with 403', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/inventory/items', {
      method: 'POST', headers: authHeaders(child.jwt), body: JSON.stringify({ name: 'Blocked' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects decommission without a reason with 400', async () => {
    const { adult } = await seedTestHousehold();
    const created = await app.request('/api/v1/inventory/items', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Toaster' }),
    });
    const { data: item } = await created.json() as { data: { id: string } };
    const res = await app.request(`/api/v1/inventory/items/${item.id}/decommission`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ date: '2026-08-01' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a PATCH with only a partial lifecycle trio with 400', async () => {
    const { adult } = await seedTestHousehold();
    const created = await app.request('/api/v1/inventory/items', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Fridge' }),
    });
    const { data: item } = await created.json() as { data: { id: string } };
    const res = await app.request(`/api/v1/inventory/items/${item.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ decommissionedAt: null }),
    });
    expect(res.status).toBe(400);
  });
});
